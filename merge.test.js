const { merge } = require('./merge.js');
const assert = require('assert');
const it = (id, text, extra) => Object.assign({ id, day: '2026-11-02', text, notes: '', done: false }, extra || {});
const base = { weekStart: '2026-11-02', tasks: [it('t1', 'A'), it('t2', 'B'), it('t3', 'C')], payroll: [it('p1', 'P')], history: [] };
const c = JSON.parse.bind(JSON), s = JSON.stringify;
let t = 0; const ok = (n) => console.log('ok', ++t, n);
// 1 both tick different items
{ const l = c(s(base)); l.tasks[0].done = true; const r = c(s(base)); r.tasks[1].done = true;
  const m = merge(base, l, r).data; assert(m.tasks[0].done && m.tasks[1].done && !m.tasks[2].done); ok('both ticks kept'); }
// 2 local add + remote add
{ const l = c(s(base)); l.tasks.push(it('t9', 'Local new')); const r = c(s(base)); r.tasks.push(it('t8', 'Remote new'));
  const m = merge(base, l, r).data; assert.deepStrictEqual(m.tasks.map(x => x.id).sort(), ['t1', 't2', 't3', 't8', 't9']); ok('both adds kept'); }
// 3 local reorder, remote tick
{ const l = c(s(base)); l.tasks = [l.tasks[2], l.tasks[0], l.tasks[1]]; const r = c(s(base)); r.tasks[0].done = true;
  const m = merge(base, l, r).data; assert.deepStrictEqual(m.tasks.map(x => x.id), ['t3', 't1', 't2']); assert(m.tasks[1].done); ok('reorder + remote tick'); }
// 4 local delete of item remote edited -> kept
{ const l = c(s(base)); l.tasks.splice(1, 1); const r = c(s(base)); r.tasks[1].text = 'B edited';
  const res = merge(base, l, r); assert(res.data.tasks.some(x => x.text === 'B edited')); ok('delete vs edit keeps edit'); }
// 5 local delete, remote unchanged -> deleted
{ const l = c(s(base)); l.tasks.splice(1, 1); const r = c(s(base));
  const m = merge(base, l, r).data; assert.deepStrictEqual(m.tasks.map(x => x.id), ['t1', 't3']); ok('plain delete'); }
// 6 remote delete, local untouched -> deleted; local edited -> kept
{ const l = c(s(base)); l.tasks[2].done = true; const r = c(s(base)); r.tasks = r.tasks.slice(0, 1);
  const m = merge(base, l, r).data; assert.deepStrictEqual(m.tasks.map(x => x.id), ['t1', 't3']); ok('remote delete vs local tick'); }
// 7 tick before rollover lands in history and carried copy removed
{ const l = c(s(base)); l.tasks[0].done = true;
  const r = { weekStart: '2026-11-09', history: [Object.assign(c(s(base)), { weekStart: '2026-11-02' })],
    tasks: [it('x1', 'A', { notes: 'carried over' }), it('x2', 'B', { notes: 'carried over' }), it('x3', 'C', { notes: 'carried over' })], payroll: [] };
  delete r.history[0].history;
  const res = merge(base, l, r); const m = res.data;
  assert(m.history[0].tasks[0].done); assert.deepStrictEqual(m.tasks.map(x => x.id), ['x2', 'x3']); ok('tick across rollover'); }
// 8 same field changed both sides -> local wins (last writer)
{ const l = c(s(base)); l.tasks[0].text = 'L'; const r = c(s(base)); r.tasks[0].text = 'R';
  assert.strictEqual(merge(base, l, r).data.tasks[0].text, 'L'); ok('same field: this device wins'); }
// 9 new list key (needFeedbackToCharge) created locally
{ const l = c(s(base)); l.needFeedbackToCharge = [it('f1', 'Fb', { amount: 50 })]; const r = c(s(base)); r.tasks[0].done = true;
  const m = merge(base, l, r).data; assert.strictEqual(m.needFeedbackToCharge[0].amount, 50); assert(m.tasks[0].done); ok('lazy list key'); }
console.log('all merge tests passed');
