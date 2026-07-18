import * as React from 'react';

export interface SpecularButtonProps {
  children?: React.ReactNode;
  size?: 'sm' | 'md' | 'lg';
  radius?: number;
  tint?: string;
  tintOpacity?: number;
  blur?: number;
  textColor?: string;
  lineColor?: string;
  baseColor?: string;
  intensity?: number;
  shineSize?: number;
  shineFade?: number;
  thickness?: number;
  speed?: number;
  followMouse?: boolean;
  proximity?: number;
  autoAnimate?: boolean;
  disabled?: boolean;
  onClick?: React.MouseEventHandler<HTMLButtonElement | HTMLAnchorElement>;
  className?: string;
  type?: 'button' | 'submit' | 'reset';
  /** Renders as a link: Next.js <Link> for in-app routes, plain <a> when `download` is set. */
  href?: string;
  download?: boolean | string;
}

declare const SpecularButton: React.FC<SpecularButtonProps>;

export default SpecularButton;
