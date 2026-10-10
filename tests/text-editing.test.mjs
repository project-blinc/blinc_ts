import assert from 'node:assert/strict';
import { test } from 'node:test';
import { TextEditing } from '../dist/native/text-editing.js';
import { MemoryClipboard } from '../dist/native/clipboard.js';

const CHAR = 10;
const LINE = 20;

/** Text measured as a monospace font would: ten wide, split into lines at each newline. */
function measure(shown) {
  const stops = [];
  let line = 0;
  let col = 0;
  stops.push({ index: 0, x: 0, line: 0 });
  for (let i = 0; i < shown.length; i++) {
    if (shown[i] === '\n') {
      line++;
      col = 0;
      stops.push({ index: i + 1, x: 0, line });
    } else {
      col++;
      stops.push({ index: i + 1, x: col * CHAR, line });
    }
  }
  return { stops, lineHeight: LINE, lines: line + 1 };
}

const key = (name, modifiers = {}) => {
  const e = {
    key: name,
    shiftKey: false,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    prevented: false,
    ...modifiers,
    preventDefault() {
      e.prevented = true;
    },
  };
  return e;
};

function editing(options = {}) {
  const clipboard = new MemoryClipboard();
  const e = new TextEditing({
    multiline: false,
    measure,
    clipboard: () => clipboard,
    mac: false,
    ...options,
  });
  e.clipboard = clipboard;
  return e;
}
const typed = (e, text) => e.type(text);

test('typing inserts at the caret and replaces a selection', () => {
  const e = editing();
  const inputs = [];
  e.onInput = (v) => inputs.push(v);
  typed(e, 'hello');
  assert.equal(e.value, 'hello');
  assert.equal(e.caret, 5);
  e.key(key('ArrowLeft'));
  e.key(key('ArrowLeft'));
  typed(e, 'XY');
  assert.equal(e.value, 'helXYlo');
  assert.equal(e.caret, 5);
  e.select(1, 4);
  typed(e, 'a');
  assert.equal(e.value, 'haYlo', 'the selection is replaced');
  assert.deepEqual(inputs, ['hello', 'helXYlo', 'haYlo']);
  // A line break in a single line field is a space; a multiline one keeps it.
  e.setValue('');
  typed(e, 'a\nb\r\nc');
  assert.equal(e.value, 'a b c');
  const area = editing({ multiline: true });
  typed(area, 'a\nb\r\nc');
  assert.equal(area.value, 'a\nb\nc');
});

test('the arrows move by character, a selection collapses to its edge, and Shift selects', () => {
  const e = editing();
  e.setValue('abcdef');
  e.key(key('ArrowLeft'));
  assert.equal(e.caret, 5);
  e.key(key('ArrowLeft', { shiftKey: true }));
  e.key(key('ArrowLeft', { shiftKey: true }));
  assert.deepEqual(e.selectionRange(), { from: 3, to: 5 });
  assert.equal(e.selection(), 'de');
  assert.equal(e.caret, 3);
  e.key(key('ArrowRight'));
  assert.equal(e.caret, 5, 'a selection collapses to its right edge going right');
  assert.equal(e.anchor, 5);
  e.select(2, 4);
  e.key(key('ArrowLeft'));
  assert.equal(e.caret, 2, 'and to its left edge going left');
  e.key(key('Home'));
  assert.equal(e.caret, 0);
  e.key(key('End', { shiftKey: true }));
  assert.equal(e.selection(), 'abcdef');
  // A single line field sends Up and Down to the ends.
  e.key(key('ArrowUp'));
  assert.equal(e.caret, 0);
  e.key(key('ArrowDown'));
  assert.equal(e.caret, 6);
});

test('Backspace and Delete erase a character, a selection or a word', () => {
  const e = editing();
  e.setValue('one two three');
  e.key(key('Backspace'));
  assert.equal(e.value, 'one two thre');
  e.key(key('ArrowLeft', { ctrlKey: true }));
  assert.equal(e.caret, 8, 'Ctrl moves by word off a Mac');
  e.key(key('Delete'));
  assert.equal(e.value, 'one two hre');
  e.key(key('Backspace', { ctrlKey: true }));
  assert.equal(e.value, 'one hre', 'a word back');
  e.select(0, 3);
  e.key(key('Backspace'));
  assert.equal(e.value, ' hre');
  e.setValue('abc');
  e.key(key('Home'));
  e.key(key('Backspace'));
  assert.equal(e.value, 'abc', 'nothing before the start');
  e.key(key('End'));
  e.key(key('Delete'));
  assert.equal(e.value, 'abc', 'nothing after the end');
  e.key(key('Delete', { ctrlKey: true }));
  assert.equal(e.value, 'abc');
  e.key(key('Home'));
  e.key(key('Delete', { ctrlKey: true }));
  assert.equal(e.value, '', 'the word after');
});

test('a Mac moves by word with Option and by line with Command', () => {
  const e = editing({ mac: true, multiline: true });
  e.setValue('one two\nthree four');
  e.key(key('ArrowLeft', { altKey: true }));
  assert.equal(e.caret, 14, 'Option moves a word');
  e.key(key('ArrowLeft', { metaKey: true }));
  assert.equal(e.caret, 8, 'Command moves to the line start');
  e.key(key('ArrowRight', { metaKey: true }));
  assert.equal(e.caret, 18, 'and the line end');
  e.key(key('Backspace', { metaKey: true }));
  assert.equal(e.value, 'one two\n', 'Command deletes to the line start');
  e.key(key('Backspace', { altKey: true }));
  assert.equal(e.value, 'one ', 'Option deletes the word before, and the break after it');
});

test('a multiline field moves between lines keeping to a column', () => {
  const e = editing({ multiline: true });
  e.setValue('abcdef\nab\nabcdef');
  e.select(5, 5);
  e.key(key('ArrowDown'));
  assert.equal(e.caret, 9, 'to the end of the short line below');
  e.key(key('ArrowDown'));
  assert.equal(e.caret, 15, 'and back to the goal column below that');
  e.key(key('ArrowUp'));
  e.key(key('ArrowUp'));
  assert.equal(e.caret, 5);
  e.key(key('ArrowUp'));
  assert.equal(e.caret, 0, 'Up on the first line goes to the start');
  e.key(key('ArrowDown', { shiftKey: true }));
  assert.equal(
    e.selection(),
    'abcdef\nab',
    'Shift extends a selection down a line, to the goal column',
  );
  e.select(8, 8);
  e.key(key('Home'));
  assert.equal(e.caret, 7, 'Home is the line start in a text area');
  e.key(key('End'));
  assert.equal(e.caret, 9);
  e.key(key('Home', { ctrlKey: true }));
  assert.equal(e.caret, 0, 'and Control with it, the start of the text');
  e.key(key('End', { ctrlKey: true }));
  assert.equal(e.caret, e.value.length);
  e.key(key('Enter'));
  assert.equal(e.value.endsWith('\n'), true, 'Enter is a new line');
  e.pageLines = () => 2;
  e.select(0, 0);
  e.key(key('PageDown'));
  assert.equal(e.stopAt(e.caret).line, 2, 'a page down moves the lines it says');
});

test('select all, copy, cut and paste', () => {
  const e = editing();
  e.setValue('hello world');
  assert.equal(e.key(key('a', { ctrlKey: true })), true);
  assert.equal(e.selection(), 'hello world');
  e.select(0, 5);
  assert.equal(e.copy(), true);
  assert.equal(e.clipboard.text(), 'hello');
  e.select(6, 11);
  assert.equal(e.cut(), true);
  assert.equal(e.value, 'hello ');
  assert.equal(e.clipboard.text(), 'world');
  e.paste('big\nwide');
  assert.equal(e.value, 'hello big wide', 'a line break is a space in one line');
  e.select(0, 5);
  e.paste('');
  assert.equal(e.value, ' big wide', 'pasting nothing over a selection deletes it');
  assert.equal(e.copy(), false, 'nothing selected, nothing copied');
  const area = editing({ multiline: true });
  area.paste('a\r\nb');
  assert.equal(area.value, 'a\nb');
  const secret = editing();
  secret.mask = '•';
  secret.setValue('hunter2');
  secret.selectAll();
  assert.equal(secret.copy(), false, 'a password cannot be copied');
  assert.equal(secret.cut(), false, 'or cut');
  assert.equal(secret.value, 'hunter2');
});

test('a password shows its mask, and a word is all of it', () => {
  const e = editing();
  e.mask = '•';
  e.setValue('hello world');
  assert.equal(e.display(), '•'.repeat(11));
  assert.equal(e.measured().stops.at(-1).x, 11 * CHAR, 'measured as shown');
  e.key(key('ArrowLeft', { ctrlKey: true }));
  assert.equal(e.caret, 0, 'moving by word gives no word away: it moves over all of it');
});

test('accept filters what is typed or pasted; maxLength cuts it', () => {
  const e = editing();
  e.accept = (text) => text.replace(/[^0-9]/g, '');
  typed(e, 'a1b2');
  assert.equal(e.value, '12');
  e.type('xyz');
  assert.equal(e.value, '12', 'nothing left is nothing typed');
  e.paste('3-4');
  assert.equal(e.value, '1234');
  const short = editing();
  short.maxLength = 5;
  typed(short, 'abcdefgh');
  assert.equal(short.value, 'abcde');
  short.select(1, 3);
  typed(short, 'XYZ');
  assert.equal(short.value, 'aXYde', 'a replaced selection makes room for what fits');
  short.type('q');
  assert.equal(short.value, 'aXYde', 'a full field takes nothing more');
});

test('an input method composes in place of the selection', () => {
  const e = editing();
  e.setValue('ab');
  e.select(0, 1);
  e.compose('に', -1);
  assert.equal(e.display(), 'にb', 'the composition shows in place of the selection');
  assert.deepEqual(e.composedRange(), { from: 0, to: 1 });
  assert.equal(e.displayCaret(), 1);
  e.compose('にほ', 1);
  assert.equal(e.displayCaret(), 1, 'at the cursor the method says');
  e.key(key('ArrowRight'));
  assert.equal(e.caret, 1, 'keys are the method while it composes (the caret did not move)');
  assert.equal(e.value, 'ab', 'and the value is not changed by it');
  e.compose('', -1);
  e.type('日本');
  assert.equal(e.value, '日本b', 'the commit replaces the selection');
  assert.equal(e.composing, '');
});

test('presses place the caret, double and triple clicks select a word and a paragraph, drags extend', () => {
  const e = editing({ multiline: true });
  e.setValue('hello big world\nsecond line');
  e.press(53, 5, false);
  assert.equal(e.caret, 5, 'the stop nearest the point');
  e.press(0, 5, true);
  assert.equal(e.selection(), 'hello', 'Shift extends to the press');
  e.press(75, 5, false, 2);
  assert.equal(e.selection(), 'big', 'a double click selects the word');
  e.drag(115, 5);
  assert.equal(e.selection(), 'big world', 'a drag extends it by words');
  e.drag(5, 5);
  assert.equal(e.selection(), 'hello big', 'back past the start of the first word');
  e.release();
  e.drag(115, 5);
  assert.equal(e.selection(), 'hello big', 'a released press drags no more');
  e.press(30, 5, false, 3);
  assert.equal(e.selection(), 'hello big world', 'a triple click selects the paragraph');
  e.press(30, 25, false, 3);
  assert.equal(e.selection(), 'second line');
  e.press(0, 25, false);
  e.drag(1000, 25);
  assert.equal(e.selection(), 'second line', 'a drag past the end stops at it');
  assert.equal(e.lineAtY(45), 2);
});

test('a disabled or read-only field does not change, and read-only still selects and copies', () => {
  let locked = false;
  let frozen = false;
  const e = editing({ disabled: () => locked, readOnly: () => frozen });
  e.setValue('fixed');
  frozen = true;
  typed(e, 'x');
  e.key(key('Backspace'));
  e.paste('y');
  assert.equal(e.value, 'fixed');
  e.key(key('Home'));
  e.key(key('ArrowRight', { shiftKey: true }));
  assert.equal(e.selection(), 'f', 'it can be selected');
  assert.equal(e.copy(), true, 'and copied');
  assert.equal(e.cut(), false, 'but not cut');
  locked = true;
  e.key(key('ArrowRight'));
  assert.equal(e.caret, 1, 'a disabled field takes no keys');
  e.press(40, 5, false);
  assert.equal(e.caret, 1, 'and no presses');
  assert.equal(e.value, 'fixed');
});

test('changes are announced, and enter and escape reach the view', () => {
  const e = editing();
  let changes = 0;
  e.onChange = () => changes++;
  let submitted = 0;
  e.onSubmit = () => submitted++;
  let escaped = 0;
  e.onEscape = () => escaped++;
  typed(e, 'ab');
  const after = changes;
  assert.ok(after >= 1);
  e.key(key('ArrowLeft'));
  assert.ok(changes > after, 'a move is a change');
  assert.equal(e.key(key('Enter')), true);
  assert.equal(submitted, 1);
  e.key(key('Escape'));
  assert.equal(escaped, 1);
  assert.equal(e.key(key('Tab')), false, 'Tab is left to move focus');
  assert.equal(e.key(key(' ')), true, 'a space is taken, to be typed as text');
  e.blur();
  assert.equal(e.anchor, e.caret, 'blurring collapses the selection');
});
