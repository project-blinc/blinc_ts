import type { Host, HostElement, HostText } from 'blinc_ts/native/host';
import { render } from '#jsx/jsx-runtime';
import { styles, type EventLog } from './styles.js';

/** The reference scene, built with the JSX runtime. */
export function jsxScene(host: Host, log: EventLog): void {
  let clicks = 0;
  let label: HostText | undefined;
  const Card = (props: { name: string; class?: string; style?: object; children?: unknown }) => (
    <div class={`card ${props.class ?? ''}`.trim()} style={{ ...styles.card, ...props.style }}>
      {`Card ${props.name}`}
      {props.children}
    </div>
  );
  render(
    host,
    <div id="app" style={styles.app} onPointerDownCapture={() => log.push('app-capture')}>
      <div class="header" style={styles.header} onClick={() => log.push('header')}>
        Blinc host
        <button
          id="counter"
          style={styles.button}
          onClick={() => {
            clicks++;
            label!.data = `Clicks: ${clicks}`;
            log.push('button');
          }}
          ref={(button: HostElement) => (label = button.firstChild as HostText)}
        >
          Clicks: 0
        </button>
      </div>
      <div class="cards" style={styles.cards}>
        <Card name="A" />
        <Card name="B">
          <div class="badge" style={styles.badge} />
        </Card>
        <Card name="C" class="first" style={styles.first} />
      </div>
      <div class="footer" style={styles.footer}>
        footer
      </div>
    </div>,
  );
}
