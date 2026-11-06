'use strict';

const { contextBridge, ipcRenderer } = require('electron');

let accountName = '';

contextBridge.exposeInMainWorld('checklistDesktop', {
  getBoot: function () {
    return ipcRenderer.invoke('checklist:boot').then(function (info) {
      accountName = (info && info.account) || '';
      if (info && info.vibrancy) document.documentElement.dataset.vibrancy = '1';
      document.documentElement.dataset.desktop = '1';
      return info;
    });
  },
  accountName: function () { return accountName; },
  signedIn: function () { return ipcRenderer.invoke('checklist:signed-in'); },
  signIn: function () { return ipcRenderer.invoke('checklist:sign-in'); },
  signOut: function () { return ipcRenderer.invoke('checklist:sign-out'); },
  useSample: function () { return ipcRenderer.invoke('checklist:use-sample'); },
  load: function () { return ipcRenderer.invoke('checklist:load'); },
  save: function (data, etag) { return ipcRenderer.invoke('checklist:save', data, etag); },
  etag: function () { return ipcRenderer.invoke('checklist:etag'); },
  setAlwaysOnTop: function (on) { return ipcRenderer.invoke('checklist:always-on-top', !!on); }
});

ipcRenderer.on('checklist:layout', function (_event, mode) {
  const full = mode === 'full';
  document.documentElement.dataset.desktop = '1';
  document.documentElement.dataset.cols = full ? '4' : '';
  document.documentElement.dataset.text = full ? 'large' : '';
  window.dispatchEvent(new Event('resize'));
});

ipcRenderer.on('checklist:pin', function (_event, on) {
  const pin = document.getElementById('btnPin');
  if (!pin) return;
  pin.classList.toggle('on', !!on);
  pin.setAttribute('aria-pressed', on ? 'true' : 'false');
  pin.title = on ? 'Window stays on top' : 'Keep window on top';
});

window.addEventListener('DOMContentLoaded', function () {
  document.documentElement.dataset.desktop = '1';
});
