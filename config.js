// Checklist Sticky web - settings.
// clientId: the Application (client) ID of the Entra app registration (SPA, personal Microsoft accounts).
// Leave empty to run in demo mode (data kept only in this browser).
window.CHECKLIST_CONFIG = {
  clientId: '',
  authority: 'https://login.microsoftonline.com/consumers',
  dataPath: 'Checklist Sticky/checklist.json',   // path inside his OneDrive
  scopes: ['Files.ReadWrite'],
  pollSeconds: 15
};
