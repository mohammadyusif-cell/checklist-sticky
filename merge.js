/* Checklist Sticky - 3-way merge of checklist.json (shared by the web app; the PC app has a PowerShell port).
   base   = the version this client last loaded from the server
   local  = this client's edited copy
   remote = what is on the server now
   Rules: items are matched by id; a field changed locally wins over the remote value for that field,
   otherwise the remote value is kept, so changes from both sides survive. Local additions are kept,
   local deletions apply only if the remote item was not changed meanwhile. A tick made before a rollover
   is applied to the archived week (and the carried-over copy is dropped) so it is never lost. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ChecklistMerge = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var SECTIONS = ['tasks', 'payroll', 'bills', 'bookkeeping', 'individualTaxes', 'companyTaxes',
    'immigration', 'personalTasks', 'clientsToCharge', 'needFeedbackToCharge'];
  var FIELDS = ['day', 'text', 'notes', 'done', 'amount', 'due'];

  function clone(x) { return x === undefined ? undefined : JSON.parse(JSON.stringify(x)); }
  function eq(a, b) { return JSON.stringify(a === undefined ? null : a) === JSON.stringify(b === undefined ? null : b); }
  function byId(list) { var m = {}; (list || []).forEach(function (i) { if (i && i.id != null) m[String(i.id)] = i; }); return m; }
  function listKeys(objs) {
    var keys = SECTIONS.slice();
    objs.forEach(function (o) {
      Object.keys(o || {}).forEach(function (k) { if (Array.isArray(o[k]) && k !== 'history' && keys.indexOf(k) < 0) keys.push(k); });
    });
    return keys;
  }
  function changedFields(b, l) {
    var out = [];
    FIELDS.forEach(function (f) { if (!eq(b[f], l[f])) out.push(f); });
    Object.keys(l).forEach(function (f) { if (FIELDS.indexOf(f) < 0 && f !== 'id' && !eq(b[f], l[f])) out.push(f); });
    return out;
  }
  function applyFields(target, src, fields) {
    fields.forEach(function (f) { if (src[f] === undefined) delete target[f]; else target[f] = clone(src[f]); });
  }
  function ids(list) { return (list || []).map(function (i) { return String(i.id); }); }

  function mergeList(b, l, r) {
    var bm = byId(b), lm = byId(l), rm = byId(r);
    var result = [];
    var conflicts = 0;
    // order: if this side reordered common items and the server did not, keep this side's order
    var common = ids(r).filter(function (id) { return bm[id] && lm[id]; });
    var bOrder = ids(b).filter(function (id) { return common.indexOf(id) >= 0; });
    var lOrder = ids(l).filter(function (id) { return common.indexOf(id) >= 0; });
    var rOrder = ids(r).filter(function (id) { return common.indexOf(id) >= 0; });
    var useLocalOrder = !eq(lOrder, bOrder) && eq(rOrder, bOrder);
    var rIds = ids(r);
    if (useLocalOrder) {
      // walk remote order, but place common items in local order
      var q = lOrder.slice();
      rIds = rIds.map(function (id) { return common.indexOf(id) >= 0 ? q.shift() : id; });
    }
    rIds.forEach(function (id) {
      var ri = rm[id], li = lm[id], bi = bm[id];
      if (bi && !li) {               // deleted here
        if (eq(ri, bi)) return;      // server unchanged: delete
        result.push(clone(ri)); conflicts++; return;   // server changed it: keep
      }
      var item = clone(ri);
      if (li) {
        var ch = bi ? changedFields(bi, li) : changedFields({}, li);
        if (!bi) ch = ch.filter(function (f) { return li[f] !== undefined; });
        applyFields(item, li, ch);
      }
      result.push(item);
    });
    // items here that the server does not have
    var lIds = ids(l);
    lIds.forEach(function (id, idx) {
      if (rm[id]) return;
      var li = lm[id], bi = bm[id];
      if (bi && eq(li, bi)) return;      // server deleted it and we did not touch it
      // new here (or changed here after the server deleted it): insert after the previous neighbour
      var pos = result.length;
      for (var k = idx - 1; k >= 0; k--) {
        var j = -1;
        for (var t = 0; t < result.length; t++) { if (String(result[t].id) === lIds[k]) { j = t; break; } }
        if (j >= 0) { pos = j + 1; break; }
        if (k === 0) pos = 0;
      }
      if (idx === 0) pos = 0;
      result.splice(pos, 0, clone(li));
    });
    return { list: result, conflicts: conflicts };
  }

  function merge(base, local, remote) {
    base = base || {}; local = local || {}; remote = remote || {};
    var out = clone(remote);
    var notes = [];
    var rolled = base.weekStart && remote.weekStart && base.weekStart !== remote.weekStart;
    listKeys([base, local, remote]).forEach(function (k) {
      if (!rolled) {
        var m = mergeList(base[k] || [], local[k] || [], remote[k] || []);
        if (m.list.length || remote[k] !== undefined || local[k] !== undefined) out[k] = m.list;
        if (m.conflicts) notes.push(k + ': kept ' + m.conflicts + ' item(s) changed elsewhere');
        return;
      }
      // the week rolled over on the server since we loaded: carry our edits into the archived week
      var bm = byId(base[k]), hist = (out.history && out.history.length) ? out.history[out.history.length - 1] : null;
      var hm = hist ? byId(hist[k]) : {};
      (local[k] || []).forEach(function (li) {
        var id = String(li.id), bi = bm[id];
        if (!bi) {                                   // added here after the rollover started: add to the new week
          var cur = out[k] || (out[k] = []);
          if (!byId(cur)[id]) cur.push(clone(li));
          return;
        }
        var ch = changedFields(bi, li);
        if (!ch.length) return;
        if (hm[id]) applyFields(hm[id], li, ch);
        if (ch.indexOf('done') >= 0 && li.done) {    // ticked before the rollover: drop its carried-over copy
          var cur2 = out[k] || [];
          for (var t = 0; t < cur2.length; t++) {
            var c = cur2[t];
            if (!c.done && c.text === bi.text && c.day === bi.day && String(c.notes || '').toLowerCase().indexOf('carried over') === 0) {
              cur2.splice(t, 1); notes.push(k + ': "' + bi.text + '" was ticked before the new week, removed its carried-over copy'); break;
            }
          }
        }
      });
    });
    // top-level scalars: take ours only if the server did not change them
    Object.keys(local).forEach(function (k) {
      if (Array.isArray(local[k]) || k === 'history') return;
      if (eq(remote[k], base[k]) && !eq(local[k], base[k])) out[k] = clone(local[k]);
    });
    return { data: out, notes: notes };
  }

  return { merge: merge, SECTIONS: SECTIONS };
});
