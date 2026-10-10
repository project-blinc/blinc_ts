import { Accordion, Collapsible } from '../../base-ui/index.js';

export default function Disclosure() {
  return (
    <div class="wiki-col" style={{ width: '100%' }}>
      <Accordion.Root defaultValue={['what']}>
        <Accordion.Item value="what">
          <Accordion.Header>
            <Accordion.Trigger>What is a part?</Accordion.Trigger>
          </Accordion.Header>
          <Accordion.Panel>
            An element with a class, and the state it is in as attributes.
          </Accordion.Panel>
        </Accordion.Item>
        <Accordion.Item value="how">
          <Accordion.Header>
            <Accordion.Trigger>How is it styled?</Accordion.Trigger>
          </Accordion.Header>
          <Accordion.Panel>By a sheet that reads the theme's variables.</Accordion.Panel>
        </Accordion.Item>
      </Accordion.Root>
      <Collapsible.Root>
        <Collapsible.Trigger>Show more</Collapsible.Trigger>
        <Collapsible.Panel>
          A collapsible holds one panel, and builds it only while it is open.
        </Collapsible.Panel>
      </Collapsible.Root>
    </div>
  );
}
