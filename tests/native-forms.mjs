import assert from 'node:assert/strict';
import { loadNative } from '../dist/native/index.js';
import { Host } from '../dist/native/host.js';
import { ThemeState, neutralTheme } from '../dist/theme/index.js';
import { addUserAgent } from '../dist/theme/user-agent.js';

const native = loadNative();
const W = 500;
const H = 400;
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
  let top = 10;
  const place = (e) => {
    e.setAttribute(
      'style',
      `${e.getAttribute('style') ?? ''}; position: absolute; left: 10px; top: ${top}px`,
    );
    top += 50;
    host.root.appendChild(e);
    return e;
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
  const entries = (data) => [...data.entries()];

  // A form of controls, one outside it that names it, and some that are not in what it holds.
  const likes = el('input', { type: 'checkbox', name: 'likes', value: 'tea' });
  const quiet = el('input', { type: 'checkbox', name: 'quiet', checked: '' });
  const nameless = el('input', { type: 'checkbox', checked: '' });
  const locked = el('input', { type: 'checkbox', name: 'locked', checked: '', disabled: '' });
  const small = el('input', { type: 'radio', name: 'size', value: 's' });
  const large = el('input', { type: 'radio', name: 'size', value: 'l', checked: '' });
  const level = el('input', { type: 'range', name: 'level', value: '30' });
  const submit = el('button', {}, ['Send']);
  const reset = el('button', { type: 'reset' }, ['Clear']);
  const plain = el('button', { type: 'button' }, ['Nothing']);
  const form = place(
    el('form', { id: 'f' }, [
      likes,
      quiet,
      nameless,
      locked,
      small,
      large,
      level,
      submit,
      reset,
      plain,
    ]),
  );
  const outside = place(
    el('input', { type: 'checkbox', name: 'extra', value: 'yes', form: 'f', checked: '' }),
  );
  const outsideSubmit = place(el('button', { form: 'f' }, ['From outside']));
  const other = place(
    el('form', {}, [el('input', { type: 'checkbox', name: 'not-mine', checked: '' })]),
  );
  host.compute(W, H);

  // What a form owns, and what it holds.
  assert.deepEqual(form.elements, [
    likes,
    quiet,
    nameless,
    locked,
    small,
    large,
    level,
    submit,
    reset,
    plain,
    outside,
    outsideSubmit,
  ]);
  assert.equal(likes.form, form);
  assert.equal(outside.form, form, 'a control that names a form belongs to it');
  assert.equal(other.elements.length, 1);
  assert.equal(host.root.form, null);
  assert.deepEqual(entries(form.formData()), [
    ['quiet', 'on'],
    ['size', 'l'],
    ['level', '30'],
    ['extra', 'yes'],
  ]);

  // A submit button submits, saying what did: bubbling, cancelable, the form's alone.
  const submissions = [];
  host.root.addEventListener('submit', (event) => {
    submissions.push({ target: event.target, submitter: event.submitter, bubbles: event.bubbles });
  });
  press(submit);
  assert.equal(submissions.length, 1);
  assert.equal(submissions[0].target, form);
  assert.equal(submissions[0].submitter, submit);
  assert.equal(submissions[0].bubbles, true);
  press(outsideSubmit);
  assert.equal(submissions.length, 2);
  assert.equal(submissions[1].target, form, 'a button outside, naming the form, submits it');
  assert.equal(submissions[1].submitter, outsideSubmit);
  press(plain);
  assert.equal(submissions.length, 2, 'a button of type button does nothing');
  submit.setAttribute('disabled', '');
  press(submit);
  assert.equal(submissions.length, 2, 'nor does a disabled one');
  submit.removeAttribute('disabled');
  // Enter on a focused submit button, and Space, submit too.
  submit.focus();
  host.input.keyDown({ key: 'Enter' });
  host.input.keyUp({ key: 'Enter' });
  assert.equal(submissions.length, 3, 'Enter on a button submits');
  host.input.keyDown({ key: ' ' });
  host.input.keyUp({ key: ' ' });
  assert.equal(submissions.length, 4, 'and Space');
  submit.blur();
  // The event is the app's to take, and it is told what the form held when it fired.
  let held = null;
  const take = (event) => {
    held = entries(event.target.formData());
    event.preventDefault();
  };
  form.addEventListener('submit', take);
  press(likes);
  assert.equal(form.requestSubmit(), false, 'a cancelled submission says so');
  assert.deepEqual(held, [
    ['likes', 'tea'],
    ['quiet', 'on'],
    ['size', 'l'],
    ['level', '30'],
    ['extra', 'yes'],
  ]);
  form.removeEventListener('submit', take);
  assert.equal(form.requestSubmit(submit), true);
  assert.throws(() => form.requestSubmit(plain), /not a submit button/);
  assert.throws(() => form.requestSubmit(other.elements[0]), TypeError);
  assert.throws(() => likes.requestSubmit(), /for a form/);

  // Reset puts every control back to where it began, and can be cancelled.
  press(small);
  level.valueAsNumber = 90;
  quiet.checked = false;
  assert.deepEqual(entries(form.formData()), [
    ['likes', 'tea'],
    ['size', 's'],
    ['level', '90'],
    ['extra', 'yes'],
  ]);
  const resets = [];
  const stop = (event) => {
    resets.push('cancelled');
    event.preventDefault();
  };
  form.addEventListener('reset', stop);
  press(reset);
  assert.deepEqual(resets, ['cancelled']);
  assert.equal(small.checked, true, 'a cancelled reset changes nothing');
  form.removeEventListener('reset', stop);
  press(reset);
  assert.equal(likes.checked, false, 'a box the user ticked is clear again');
  assert.equal(quiet.checked, true, 'one a script cleared is as its attribute says');
  assert.equal(small.checked, false);
  assert.equal(large.checked, true, 'a radio goes back to the one that began checked');
  assert.equal(level.valueAsNumber, 30, 'and a range to its attribute');
  assert.equal(large.hasState('checked'), true);
  assert.equal(small.hasState('checked'), false);
  assert.equal(form.reset(), true);
  // After a reset the attribute is what counts again.
  quiet.removeAttribute('checked');
  assert.equal(quiet.checked, false, 'a control not touched since follows its attribute');
  assert.deepEqual(errors, [], String(errors));
  state.dispose();
} finally {
  host.dispose();
  context.dispose();
}
console.log('Native forms: elements, FormData, submit, reset and buttons passed');
