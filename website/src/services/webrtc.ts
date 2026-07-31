/**
 * WebRTC call manager — mesh video/audio calls between room participants.
 *
 * Media never touches our servers: peers connect directly (or via STUN for NAT
 * traversal), and signaling (SDP offers/answers, ICE candidates) piggybacks on
 * the room's existing Supabase Realtime channel as WEBRTC_SIGNAL broadcasts,
 * addressed to a single recipient the same way the rest of the app already
 * broadcasts room-wide events.
 *
 * Renegotiation (camera turning on mid-call, etc.) follows the "perfect
 * negotiation" pattern: each pair deterministically agrees on a polite/impolite
 * role from userId comparison, so both sides can independently trigger
 * renegotiation without colliding.
 */

import type { RealtimeChannel } from './realtimeService';
import type { PeerConnectionStatus, WebrtcSignalPayload } from '@/types/room';

const STUN_SERVERS: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }];

/** Total in-call participants (including the joiner) above which a new join defaults to audio-only. */
const VIDEO_PARTICIPANT_THRESHOLD = 5;

export interface LocalCallState {
  inCall: boolean;
  cameraOn: boolean;
  micOn: boolean;
  /** null = not yet requested, false = the user denied camera/mic permission. */
  hasMediaPermission: boolean | null;
}

type RemoteStreamHandler = (userId: string, stream: MediaStream | null) => void;
type PeerStatusHandler = (userId: string, status: PeerConnectionStatus) => void;
type LocalStateHandler = (state: LocalCallState) => void;
type BandwidthSafeguardHandler = () => void;

interface PeerEntry {
  pc: RTCPeerConnection;
  polite: boolean;
  makingOffer: boolean;
  ignoreOffer: boolean;
}

export interface CallManager {
  join: () => Promise<void>;
  leave: () => void;
  toggleCamera: () => void;
  toggleMic: () => void;
  /** Switch between front/back camera. No-op on desktop or when the camera is off. */
  switchCamera: () => Promise<void>;
  /** Tell the manager who else is currently in the call (drives peer connection lifecycle). */
  syncPeers: (peerIds: string[]) => void;
  getLocalStream: () => MediaStream | null;
  onRemoteStream: (handler: RemoteStreamHandler) => () => void;
  onPeerStatusChange: (handler: PeerStatusHandler) => () => void;
  onLocalStateChange: (handler: LocalStateHandler) => () => void;
  onBandwidthSafeguard: (handler: BandwidthSafeguardHandler) => () => void;
  /** Tear everything down — call on room disconnect. */
  destroy: () => void;
}

function mapConnectionState(state: RTCPeerConnectionState): PeerConnectionStatus {
  switch (state) {
    case 'connected':
      return 'connected';
    case 'failed':
      return 'failed';
    case 'closed':
    case 'disconnected':
      return 'closed';
    default:
      return 'connecting';
  }
}

export function createCallManager(channel: RealtimeChannel, localUserId: string): CallManager {
  const peers = new Map<string, PeerEntry>();
  const remoteStreams = new Map<string, MediaStream>();
  let currentPeerIds = new Set<string>();

  let localStream: MediaStream | null = null;
  let facingMode: 'user' | 'environment' = 'user';
  let inCall = false;
  let cameraOn = false;
  let micOn = false;
  let hasMediaPermission: boolean | null = null;

  const remoteStreamHandlers = new Set<RemoteStreamHandler>();
  const peerStatusHandlers = new Set<PeerStatusHandler>();
  const localStateHandlers = new Set<LocalStateHandler>();
  const bandwidthSafeguardHandlers = new Set<BandwidthSafeguardHandler>();

  const emitLocalState = () => {
    // Mirrors the same updatePresence() mechanism already used for username/role,
    // so UsersPanel and a video tile grid both read from one presence roster.
    channel.updatePresence({ inCall, cameraOn, micOn });
    const state: LocalCallState = { inCall, cameraOn, micOn, hasMediaPermission };
    localStateHandlers.forEach((h) => h(state));
  };

  const sendSignal = (to: string, kind: WebrtcSignalPayload['kind'], data: unknown) => {
    const payload: WebrtcSignalPayload = { to, kind, data };
    channel.broadcast('WEBRTC_SIGNAL', payload as unknown as Record<string, unknown>);
  };

  const closePeer = (peerId: string) => {
    const entry = peers.get(peerId);
    if (!entry) return;
    entry.pc.close();
    peers.delete(peerId);
    remoteStreams.delete(peerId);
    remoteStreamHandlers.forEach((h) => h(peerId, null));
    peerStatusHandlers.forEach((h) => h(peerId, 'closed'));
  };

  const createPeerEntry = (peerId: string): PeerEntry => {
    const pc = new RTCPeerConnection({ iceServers: STUN_SERVERS });
    const entry: PeerEntry = {
      pc,
      polite: localUserId > peerId,
      makingOffer: false,
      ignoreOffer: false,
    };

    if (localStream) {
      localStream.getTracks().forEach((track) => pc.addTrack(track, localStream!));
    }

    pc.onnegotiationneeded = async () => {
      try {
        entry.makingOffer = true;
        await pc.setLocalDescription();
        sendSignal(
          peerId,
          pc.localDescription!.type === 'offer' ? 'offer' : 'answer',
          pc.localDescription
        );
      } catch (err) {
        console.warn('[SyncFlix] WebRTC negotiation failed:', err);
      } finally {
        entry.makingOffer = false;
      }
    };

    pc.onicecandidate = ({ candidate }) => {
      if (candidate) sendSignal(peerId, 'ice', candidate.toJSON());
    };

    pc.ontrack = (event) => {
      const [stream] = event.streams;
      if (!stream) return;
      remoteStreams.set(peerId, stream);
      remoteStreamHandlers.forEach((h) => h(peerId, stream));
    };

    pc.onconnectionstatechange = () => {
      peerStatusHandlers.forEach((h) => h(peerId, mapConnectionState(pc.connectionState)));
    };

    return entry;
  };

  const ensurePeer = (peerId: string): PeerEntry => {
    let entry = peers.get(peerId);
    if (!entry) {
      entry = createPeerEntry(peerId);
      peers.set(peerId, entry);
      peerStatusHandlers.forEach((h) => h(peerId, 'connecting'));
    }
    return entry;
  };

  // Perfect-negotiation message handler: https://developer.mozilla.org/docs/Web/API/WebRTC_API/Perfect_negotiation
  const handleSignal = async (peerId: string, signal: WebrtcSignalPayload) => {
    const entry = ensurePeer(peerId);
    const { pc } = entry;
    if (signal.kind === 'offer' || signal.kind === 'answer') {
      const description = signal.data as RTCSessionDescriptionInit;
      const offerCollision =
        description.type === 'offer' && (entry.makingOffer || pc.signalingState !== 'stable');
      entry.ignoreOffer = !entry.polite && offerCollision;
      if (entry.ignoreOffer) return;
      await pc.setRemoteDescription(description);
      if (description.type === 'offer') {
        await pc.setLocalDescription();
        sendSignal(peerId, 'answer', pc.localDescription);
      }
    } else if (signal.kind === 'ice') {
      try {
        await pc.addIceCandidate(signal.data as RTCIceCandidateInit);
      } catch (err) {
        if (!entry.ignoreOffer) console.warn('[SyncFlix] Failed to add ICE candidate:', err);
      }
    }
  };

  channel.subscribe('WEBRTC_SIGNAL', (payload, senderId) => {
    if (!inCall || senderId === localUserId) return;
    const signal = payload as unknown as WebrtcSignalPayload;
    if (signal.to !== localUserId) return; // addressed to someone else in the room
    void handleSignal(senderId, signal);
  });

  const syncPeers = (peerIds: string[]) => {
    currentPeerIds = new Set(peerIds.filter((id) => id !== localUserId));
    if (!inCall) return;
    currentPeerIds.forEach((id) => ensurePeer(id));
    Array.from(peers.keys())
      .filter((id) => !currentPeerIds.has(id))
      .forEach((id) => closePeer(id));
  };

  const join = async () => {
    if (inCall) return;
    // +1 for the joiner themself: joining as e.g. the 6th participant defaults
    // to audio-only so a rare big group call doesn't choke everyone's upload.
    const wantVideo = currentPeerIds.size + 1 <= VIDEO_PARTICIPANT_THRESHOLD;
    try {
      localStream = await navigator.mediaDevices.getUserMedia({ video: wantVideo, audio: true });
    } catch {
      try {
        // Camera may be unavailable/denied while mic still works — degrade rather than fail outright.
        localStream = await navigator.mediaDevices.getUserMedia({ video: false, audio: true });
      } catch (err) {
        console.warn('[SyncFlix] Camera/mic permission denied:', err);
        hasMediaPermission = false;
        localStateHandlers.forEach((h) =>
          h({ inCall: false, cameraOn: false, micOn: false, hasMediaPermission })
        );
        return;
      }
    }

    hasMediaPermission = true;
    inCall = true;
    cameraOn = localStream.getVideoTracks().length > 0;
    micOn = localStream.getAudioTracks().length > 0;
    if (!wantVideo && currentPeerIds.size > 0) {
      bandwidthSafeguardHandlers.forEach((h) => h());
    }
    emitLocalState();
    currentPeerIds.forEach((id) => ensurePeer(id));
  };

  const leave = () => {
    if (!inCall) return;
    Array.from(peers.keys()).forEach((id) => closePeer(id));
    localStream?.getTracks().forEach((track) => track.stop());
    localStream = null;
    inCall = false;
    cameraOn = false;
    micOn = false;
    emitLocalState();
  };

  const toggleMic = () => {
    if (!inCall || !localStream) return;
    micOn = !micOn;
    localStream.getAudioTracks().forEach((track) => (track.enabled = micOn));
    emitLocalState();
  };

  const toggleCamera = async () => {
    if (!inCall || !localStream) return;
    if (cameraOn) {
      localStream.getVideoTracks().forEach((track) => (track.enabled = false));
      cameraOn = false;
      emitLocalState();
      return;
    }
    const existingTrack = localStream.getVideoTracks()[0];
    if (existingTrack) {
      existingTrack.enabled = true;
      cameraOn = true;
      emitLocalState();
      return;
    }
    // First time turning the camera on this call (e.g. joined audio-only under
    // the bandwidth safeguard) — acquire a track and add it to every peer.
    // pc.addTrack fires each connection's onnegotiationneeded automatically.
    try {
      const videoStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode } });
      const [track] = videoStream.getVideoTracks();
      if (!track) return;
      localStream.addTrack(track);
      peers.forEach((entry) => entry.pc.addTrack(track, localStream!));
      cameraOn = true;
      emitLocalState();
    } catch (err) {
      console.warn('[SyncFlix] Failed to enable camera:', err);
    }
  };

  const switchCamera = async () => {
    if (!inCall || !cameraOn || !localStream) return;
    const nextFacing = facingMode === 'user' ? 'environment' : 'user';
    try {
      const newStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: nextFacing },
      });
      const [newTrack] = newStream.getVideoTracks();
      if (!newTrack) return;
      const [oldTrack] = localStream.getVideoTracks();
      if (oldTrack) {
        localStream.removeTrack(oldTrack);
        oldTrack.stop();
      }
      localStream.addTrack(newTrack);
      // replaceTrack keeps the existing transceiver — no renegotiation needed.
      peers.forEach((entry) => {
        const sender = entry.pc.getSenders().find((s) => s.track?.kind === 'video');
        void sender?.replaceTrack(newTrack);
      });
      facingMode = nextFacing;
    } catch (err) {
      console.warn('[SyncFlix] Failed to switch camera:', err);
    }
  };

  return {
    join,
    leave,
    toggleCamera,
    toggleMic,
    switchCamera,
    syncPeers,
    getLocalStream: () => localStream,
    onRemoteStream: (handler) => {
      remoteStreamHandlers.add(handler);
      return () => remoteStreamHandlers.delete(handler);
    },
    onPeerStatusChange: (handler) => {
      peerStatusHandlers.add(handler);
      return () => peerStatusHandlers.delete(handler);
    },
    onLocalStateChange: (handler) => {
      localStateHandlers.add(handler);
      return () => localStateHandlers.delete(handler);
    },
    onBandwidthSafeguard: (handler) => {
      bandwidthSafeguardHandlers.add(handler);
      return () => bandwidthSafeguardHandlers.delete(handler);
    },
    destroy: () => {
      leave();
      remoteStreamHandlers.clear();
      peerStatusHandlers.clear();
      localStateHandlers.clear();
      bandwidthSafeguardHandlers.clear();
    },
  };
}
