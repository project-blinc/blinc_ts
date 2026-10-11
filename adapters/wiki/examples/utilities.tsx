import { classes, type UtilityClass } from 'blinc_ts/theme/utilities';
import { signal } from '#jsx/owner';

// One choice in each family; the sample's class is the chosen ones together.
const families: [string, UtilityClass[]][] = [
  [
    'Background',
    ['bg-surface', 'bg-primary', 'bg-accent-subtle', 'bg-success-bg', 'bg-warning-bg'],
  ],
  ['Text colour', ['text-text-primary', 'text-text-inverse', 'text-success', 'text-warning']],
  ['Padding', ['p-2', 'p-4', 'p-6', 'px-8']],
  ['Radius', ['rounded-none', 'rounded-md', 'rounded-xl', 'rounded-3xl', 'rounded-full']],
  ['Shadow', ['shadow-none', 'shadow-sm', 'shadow-md', 'shadow-xl', 'shadow-inner']],
  ['Size', ['text-sm', 'text-lg', 'text-2xl']],
  ['Weight', ['font-normal', 'font-semibold', 'font-black']],
  ['Corner', ['corner-round', 'corner-squircle', 'corner-bevel', 'corner-scoop']],
];

export default function Utilities() {
  const chosen = families.map(([, names]) => signal<UtilityClass>(names[0]!));
  const className = () => classes(...chosen.map((c) => c.get()));
  return (
    <div class="wiki-col" style={{ width: '100%' }}>
      <div
        class={classes('bg-surface', 'rounded-xl', 'shadow-md', 'p-5', 'gap-2', 'border-border')}
      >
        <span class={classes('text-lg', 'font-semibold')}>Made of utilities</span>
        <span class={classes('text-sm', 'text-text-secondary')}>
          bg-surface rounded-xl shadow-md p-5 gap-2, and nothing else
        </span>
      </div>
      {families.map(([name, names], i) => (
        <div class="wiki-row">
          <span class="wiki-chip-label">{name}</span>
          <div class="wiki-chips">
            {names.map((utility) => (
              <button
                class="wiki-chip"
                data-active={() => (chosen[i]!.get() === utility ? '' : undefined)}
                onClick={() => chosen[i]!.set(utility)}
              >
                {utility}
              </button>
            ))}
          </div>
        </div>
      ))}
      {/* A stage of fixed height, so the chips above and the readout below stay where they are
          whatever the sample's padding and type. */}
      <div
        style={{
          height: 150,
          alignSelf: 'stretch',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <div class={className}>A sample</div>
      </div>
      <span class="wiki-readout">{() => `class="${className()}"`}</span>
    </div>
  );
}
