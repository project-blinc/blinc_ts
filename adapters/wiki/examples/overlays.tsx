import { Dialog, Popover, Tooltip } from '../../base-ui/index.js';

export default function Overlays() {
  return (
    <div class="wiki-row">
      <Tooltip.Root delay={300}>
        <Tooltip.Trigger>Hover me</Tooltip.Trigger>
        <Tooltip.Popup side="top">A tooltip, over the page</Tooltip.Popup>
      </Tooltip.Root>
      <Popover.Root>
        <Popover.Trigger>Popover</Popover.Trigger>
        <Popover.Popup side="bottom" align="start">
          <Popover.Title>Settings</Popover.Title>
          <Popover.Description>Closes on Escape, or a press outside.</Popover.Description>
          <Popover.Close>Done</Popover.Close>
        </Popover.Popup>
      </Popover.Root>
      <Dialog.Root>
        <Dialog.Trigger>Dialog</Dialog.Trigger>
        <Dialog.Popup>
          <Dialog.Title>Delete the file?</Dialog.Title>
          <Dialog.Description>
            This cannot be undone. Tab stays inside until it closes.
          </Dialog.Description>
          <div class="wiki-row">
            <Dialog.Close>Cancel</Dialog.Close>
            <Dialog.Close>Delete</Dialog.Close>
          </div>
        </Dialog.Popup>
      </Dialog.Root>
    </div>
  );
}
