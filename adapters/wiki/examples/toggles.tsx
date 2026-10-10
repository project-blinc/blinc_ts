import { Check, Checkbox, Moon, Sun, Switch, Toggle } from '../../base-ui/index.js';
import { signal } from '#jsx/owner';

export default function Toggles() {
  // A signal given as `checked` is shared both ways: the switch writes it and reads it.
  const notifications = signal(true);
  const bold = signal(false);
  return (
    <div class="wiki-col">
      <div class="wiki-row">
        <Switch.Root checked={notifications}>
          <Switch.Thumb />
        </Switch.Root>
        <span>Notifications are {() => (notifications.get() ? 'on' : 'off')}</span>
      </div>
      <div class="wiki-row">
        <Switch.Root size="lg">
          <Switch.Thumb>
            <Sun class="bui-thumb-unchecked" />
            <Moon class="bui-thumb-checked" />
          </Switch.Thumb>
        </Switch.Root>
        <span>An icon on the knob, day and night</span>
      </div>
      <div class="wiki-row">
        <Checkbox.Root defaultChecked>
          <Checkbox.Indicator keepMounted>
            <Check />
          </Checkbox.Indicator>
        </Checkbox.Root>
        <span>Held by the checkbox itself</span>
      </div>
      <div class="wiki-row">
        <Toggle pressed={bold}>Bold</Toggle>
        <span class="wiki-readout">pressed = {() => String(bold.get())}</span>
        <button onClick={() => notifications.set(!notifications.get())}>
          Flip the first switch from outside
        </button>
      </div>
    </div>
  );
}
