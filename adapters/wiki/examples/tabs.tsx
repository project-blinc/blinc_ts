import { Tabs } from '../../base-ui/index.js';
import { signal } from '#jsx/owner';

export default function TabsExample() {
  const chosen = signal('parts');
  return (
    <div class="wiki-col" style={{ width: '100%' }}>
      <Tabs.Root value={chosen}>
        <Tabs.List activateOnFocus>
          <Tabs.Tab value="parts">Parts</Tabs.Tab>
          <Tabs.Tab value="state">State</Tabs.Tab>
          <Tabs.Tab value="style" disabled>
            Style
          </Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="parts">A root, a list of tabs and a panel for each value.</Tabs.Panel>
        <Tabs.Panel value="state">The chosen value is a signal you can read and write.</Tabs.Panel>
      </Tabs.Root>
      <span class="wiki-readout">value = {chosen}</span>
    </div>
  );
}
