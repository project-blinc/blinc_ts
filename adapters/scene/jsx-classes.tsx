import type { Host, HostElement } from 'blinc_ts/native/host';
import { render } from '#jsx/jsx-runtime';

/** Three tiles styled by class; the returned function switches the middle one on. */
export function jsxClasses(host: Host): () => void {
  let middle: HostElement | undefined;
  render(
    host,
    <div class="panel">
      <div class="tile" />
      <div class="tile" ref={(e: HostElement) => (middle = e)} />
      <div class="tile on" />
    </div>,
  );
  return () => middle!.classList.add('on');
}
