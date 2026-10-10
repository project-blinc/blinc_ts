import assert from 'node:assert/strict';
import { loadNative } from '../dist/native/index.js';
import { Host } from '../dist/native/host.js';
import { ThemeState, neutralTheme } from '../dist/theme/index.js';
import { addUserAgent } from '../dist/theme/user-agent.js';

const native = loadNative();
const W = 500;
const H = 600;
const context = native.createReactive();
const host = Host.create(native);
try {
  const errors = [];
  host.onStyleErrors((e) => errors.push(...e));
  const state = new ThemeState(context, neutralTheme, { scheme: 'light' });
  state.attach(host.layout);
  addUserAgent(host.layout);
  const el = (tag, attributes = {}, children = []) => {
    const e = host.createElement(tag);
    for (const [k, v] of Object.entries(attributes)) {
      e.setAttribute(k, v);
    }
    for (const c of children) {
      e.appendChild(typeof c === 'string' ? host.createTextNode(c) : c);
    }
    return e;
  };
  const stack = el('div', {
    style: 'position: absolute; left: 10px; top: 10px; gap: 8px; align-items: flex-start',
  });
  host.root.appendChild(stack);
  const place = (e) => {
    stack.appendChild(e);
    return e;
  };
  const settle = () => {
    host.flush();
    host.compute(W, H);
    host.compute(W, H);
  };
  const tap = (key) => {
    host.input.keyDown({
      key,
      modifiers: { shift: false, control: false, alt: false, meta: false },
    });
    host.input.keyUp({ key, modifiers: { shift: false, control: false, alt: false, meta: false } });
  };
  const centre = (e) => {
    const [x, y, w, h] = e.bounds();
    return [x + w / 2, y + h / 2];
  };
  const press = (e) => {
    const [x, y] = centre(e);
    host.input.pointerMove(x, y);
    host.input.pointerDown();
    host.input.pointerUp();
    host.input.pointerMove(W - 1, H - 1);
  };
  /** Type into a field the way a user does: focus it, then text. */
  const typeInto = (e, text) => {
    e.focus();
    host.input.text(text);
  };
  const states = (e) =>
    ['valid', 'invalid', 'user-valid', 'user-invalid', 'required', 'optional']
      .filter((s) => e.hasState(s))
      .join(' ');

  // A required text field: invalid while empty, but not yet the user's fault.
  const name = place(el('input', { name: 'name', required: '' }));
  const nick = place(el('input', { name: 'nick' }));
  settle();
  assert.equal(states(name), 'invalid required');
  assert.equal(states(nick), 'valid optional');
  assert.equal(name.willValidate, true);
  assert.equal(name.validity.valueMissing, true);
  assert.equal(name.validity.valid, false);
  assert.equal(name.validationMessage, 'Please fill in this field.');
  assert.equal(nick.validationMessage, '');
  assert.equal(nick.validity.valid, true);

  // A script setting a value does not touch it; the user leaving it after an edit does.
  name.value = 'x';
  settle();
  assert.equal(states(name), 'valid required');
  name.value = '';
  settle();
  assert.equal(states(name), 'invalid required', 'a script is not the user');
  typeInto(name, 'Ada');
  settle();
  assert.equal(states(name), 'valid required', "valid at once, but not the user's until left");
  name.blur();
  settle();
  assert.equal(states(name), 'valid user-valid required');
  name.value = '';
  settle();
  assert.equal(states(name), 'invalid user-invalid required', 'now it shows');
  assert.equal(name.validity.customError, false);

  // Leaving a field that was not edited touches nothing.
  nick.focus();
  nick.blur();
  settle();
  assert.equal(states(nick), 'valid optional');

  // A pattern must match the whole value; one that is not an expression constrains nothing.
  const code = place(el('input', { pattern: '[A-Z]{3}' }));
  const broken = place(el('input', { pattern: '(' }));
  code.value = 'abc';
  broken.value = 'anything';
  settle();
  assert.equal(code.validity.patternMismatch, true);
  assert.equal(code.validationMessage, 'Please match the requested format.');
  assert.equal(broken.validity.valid, true);
  code.value = 'ABC';
  settle();
  assert.equal(code.validity.valid, true);
  code.value = 'ABCD';
  assert.equal(code.validity.patternMismatch, true, 'the whole value, not a part');
  code.value = '';
  assert.equal(code.validity.valid, true, 'empty is not checked against a pattern');

  // Too short only once the user has typed; too long when a limit is set below what it holds.
  const short = place(el('input', { minlength: '3', value: 'ab' }));
  const long = place(el('input'));
  settle();
  assert.equal(short.validity.valid, true, 'a value the user did not type is not too short');
  short.focus();
  tap('Backspace');
  settle();
  assert.equal(short.value, 'a');
  assert.equal(short.validity.tooShort, true);
  assert.equal(short.validationMessage, 'Please lengthen this text to 3 characters or more.');
  host.input.text('bc');
  settle();
  assert.equal(short.validity.valid, true);
  short.blur();
  typeInto(long, 'abcdef');
  long.blur();
  long.setAttribute('maxlength', '4');
  settle();
  assert.equal(long.validity.tooLong, true);
  assert.equal(long.validationMessage, 'Please shorten this text to 4 characters or less.');

  // Email and URL.
  const email = place(el('input', { type: 'email' }));
  const link = place(el('input', { type: 'url' }));
  email.value = 'ada';
  settle();
  assert.equal(email.validity.typeMismatch, true);
  assert.equal(email.validationMessage, 'Please include an "@" in the email address.');
  email.value = 'ada@';
  assert.equal(email.validationMessage, 'Please enter an email address.');
  email.value = 'ada@lovelace.org';
  assert.equal(email.validity.valid, true);
  link.value = 'lovelace';
  assert.equal(link.validity.typeMismatch, true);
  assert.equal(link.validationMessage, 'Please enter a URL.');
  link.value = 'https://lovelace.org/a?b=1';
  assert.equal(link.validity.valid, true);

  // Numbers: bounds and step, from the minimum.
  const count = place(el('input', { type: 'number', min: '1', max: '9', step: '2' }));
  const check = (value) => {
    count.value = value;
    return count.validationMessage;
  };
  assert.equal(check('0'), 'Value must be greater than or equal to 1.');
  assert.equal(count.validity.rangeUnderflow, true);
  assert.equal(check('11'), 'Value must be less than or equal to 9.');
  assert.equal(count.validity.rangeOverflow, true);
  assert.equal(check('4'), 'Please enter a valid value.');
  assert.equal(count.validity.stepMismatch, true);
  assert.equal(check('5'), '');
  assert.equal(check('1.5e0'), 'Please enter a valid value.');
  assert.equal(check('abc'), 'Please enter a number.');
  assert.equal(count.validity.badInput, true);
  assert.equal(check('0x10'), 'Please enter a number.');
  assert.equal(check(''), '');

  // A box that must be ticked; a radio set that needs one; a select that needs a choice.
  const agree = place(el('input', { type: 'checkbox', required: '' }));
  const small = place(el('input', { type: 'radio', name: 'size', required: '' }));
  const large = place(el('input', { type: 'radio', name: 'size', required: '' }));
  const pick = place(
    el('select', { required: '' }, [
      el('option', { value: '' }, ['Choose']),
      el('option', { value: 'a' }, ['A']),
    ]),
  );
  settle();
  assert.equal(states(agree), 'invalid required');
  assert.equal(agree.validationMessage, 'Please tick this box if you want to proceed.');
  assert.equal(states(small), 'invalid required');
  assert.equal(small.validationMessage, 'Please select one of these options.');
  assert.equal(states(pick), 'invalid required');
  assert.equal(pick.validationMessage, 'Please select an item in the list.');
  press(agree);
  press(large);
  pick.value = 'a';
  settle();
  assert.equal(states(agree), 'valid user-valid required');
  assert.equal(states(small), 'valid user-valid required', 'a set is valid together');
  assert.equal(states(large), 'valid user-valid required');
  assert.equal(states(pick), 'valid required');
  agree.checked = false;
  settle();
  assert.equal(states(agree), 'invalid user-invalid required');
  pick.selectedIndex = 0;
  settle();
  assert.equal(states(pick), 'invalid required');

  // Disabled, read-only and fieldset-disabled controls are not checked; other inputs never are.
  const off = place(el('input', { required: '', disabled: '' }));
  const frozen = place(el('input', { required: '', readonly: '' }));
  const fieldset = place(el('fieldset', {}, [el('input', { required: '' })]));
  const slider = place(el('input', { type: 'range', required: '' }));
  const date = place(el('input', { type: 'date', required: '' }));
  settle();
  for (const e of [off, frozen, slider, date]) {
    assert.equal(e.willValidate, false);
    assert.equal(e.hasState('valid') || e.hasState('invalid'), false);
    assert.equal(e.validity.valid, true);
    assert.equal(e.checkValidity(), true);
  }
  assert.equal(off.hasState('required'), true, 'still required, though not checked');
  assert.equal(slider.hasState('required'), false, 'a range cannot be required');
  const inside = fieldset.firstChild;
  assert.equal(inside.hasState('invalid'), true);
  fieldset.setAttribute('disabled', '');
  settle();
  assert.equal(inside.hasState('invalid'), false, 'a disabled fieldset bars what it holds');
  assert.equal(inside.hasState('valid'), false);
  fieldset.removeAttribute('disabled');
  off.removeAttribute('disabled');
  settle();
  assert.equal(states(off), 'invalid required');
  assert.equal(inside.hasState('invalid'), true);
  off.setAttribute('disabled', '');
  settle();

  // A control moved into a disabled fieldset is barred by it, and checked again out of it.
  const stray = place(el('input', { required: '' }));
  settle();
  assert.equal(stray.hasState('invalid'), true);
  fieldset.setAttribute('disabled', '');
  fieldset.appendChild(stray);
  settle();
  assert.equal(stray.hasState('invalid'), false, 'a disabled fieldset bars what moves into it');
  place(stray);
  settle();
  assert.equal(stray.hasState('invalid'), true);
  assert.equal(stray.willValidate, true);
  fieldset.removeAttribute('disabled');

  // A script checking one radio settles the set, which the other radio shows too.
  const left = place(el('input', { type: 'radio', name: 'side', required: '' }));
  const right = place(el('input', { type: 'radio', name: 'side', required: '' }));
  settle();
  assert.equal(left.hasState('invalid') && right.hasState('invalid'), true);
  right.checked = true;
  settle();
  assert.equal(left.hasState('valid') && right.hasState('valid'), true);
  assert.equal(left.validity.valueMissing, false);

  // A message of a script's.
  const custom = place(el('input', { value: 'taken' }));
  settle();
  assert.equal(custom.validity.valid, true);
  custom.setCustomValidity('That name is taken.');
  settle();
  assert.equal(custom.hasState('invalid'), true);
  assert.equal(custom.validity.customError, true);
  assert.equal(custom.validationMessage, 'That name is taken.');
  custom.setCustomValidity('');
  settle();
  assert.equal(custom.hasState('valid'), true);
  assert.equal(custom.validationMessage, '');

  // checkValidity says so with an `invalid` event, which does not bubble and can be cancelled;
  // reportValidity also moves focus to the control.
  const heard = [];
  const listen = (e) =>
    e.addEventListener('invalid', (event) => {
      heard.push([e, event.bubbles, event.cancelable]);
    });
  listen(name);
  listen(nick);
  host.root.addEventListener('invalid', () => heard.push('bubbled'));
  assert.equal(name.checkValidity(), false);
  assert.equal(nick.checkValidity(), true);
  assert.deepEqual(heard, [[name, false, true]]);
  heard.length = 0;
  nick.focus();
  assert.equal(name.reportValidity(), false);
  assert.equal(host.input.focused, name);
  settle();
  assert.equal(name.hasState('user-invalid'), true);
  stack.removeChild(name);
  stack.removeChild(nick);

  // A form: invalid, it is not submitted; the first invalid control takes focus and every
  // control shows as the user's.
  const first = el('input', { name: 'first', required: '' });
  const second = el('input', { name: 'second', required: '' });
  const done = el('input', { name: 'done', value: 'ok' });
  const send = el('button', {}, ['Send']);
  const quick = el('button', { formnovalidate: '' }, ['Skip checks']);
  const form = place(el('form', {}, [first, second, done, send, quick]));
  settle();
  const sent = [];
  form.addEventListener('submit', (event) => {
    sent.push(event.submitter);
    event.preventDefault();
  });
  const invalids = [];
  for (const e of [first, second, done]) {
    e.addEventListener('invalid', () => invalids.push(e));
  }
  assert.equal(form.checkValidity(), false);
  assert.deepEqual(invalids, [first, second], 'each invalid control is told, none valid');
  invalids.length = 0;
  assert.equal(first.hasState('user-invalid'), false, 'checking is not reporting');
  press(send);
  settle();
  assert.deepEqual(sent, [], 'an invalid form is not submitted');
  assert.deepEqual(invalids, [first, second]);
  assert.equal(host.input.focused, first, 'the first invalid control takes focus');
  assert.equal(states(first), 'invalid user-invalid required');
  assert.equal(states(second), 'invalid user-invalid required');
  assert.equal(states(done), 'valid user-valid optional');
  assert.equal(form.requestSubmit(), false);

  // A submit button that opts out, or a form that does, is not checked.
  press(quick);
  assert.deepEqual(sent, [quick]);
  form.setAttribute('novalidate', '');
  assert.equal(form.requestSubmit(), false, 'the listener cancels it');
  assert.equal(sent.length, 2, 'but a novalidate form got as far as submitting');
  form.removeAttribute('novalidate');

  // Fix it and it goes through.
  first.value = 'a';
  second.value = 'b';
  settle();
  assert.equal(form.checkValidity(), true);
  sent.length = 0;
  press(send);
  assert.deepEqual(sent, [send]);

  // Reset is a clean start: nothing is the user's any more.
  second.value = '';
  settle();
  assert.equal(second.hasState('user-invalid'), true);
  form.reset();
  settle();
  assert.equal(states(first), 'invalid required', 'back to its attribute, and not yet touched');
  assert.equal(states(second), 'invalid required');

  // A control added or removed is checked as it arrives.
  const late = el('input', { required: '' });
  form.appendChild(late);
  settle();
  assert.equal(late.hasState('invalid'), true);
  assert.equal(form.checkValidity(), false);
  form.removeChild(late);
  first.value = 'a';
  second.value = 'b';
  settle();
  assert.equal(form.checkValidity(), true, 'a control that left the form no longer counts');

  // A control that stops being a text field is not checked.
  const flip = place(el('input', { required: '' }));
  settle();
  assert.equal(flip.hasState('invalid'), true);
  flip.setAttribute('type', 'date');
  settle();
  assert.equal(flip.hasState('invalid'), false);
  flip.setAttribute('type', 'text');
  settle();
  assert.equal(flip.hasState('invalid'), true);

  // A textarea reads its text.
  const note = place(el('textarea', { required: '' }));
  settle();
  assert.equal(note.hasState('invalid'), true);
  note.value = 'text';
  settle();
  assert.equal(note.hasState('valid'), true);

  assert.deepEqual(errors, [], String(errors));
  state.dispose();
} finally {
  host.dispose();
  context.dispose();
}
console.log('Native validity: constraints, states, checks and form submission passed');
