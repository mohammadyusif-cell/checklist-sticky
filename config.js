// Checklist Sticky web - settings.
// clientId: the Application (client) ID of the Entra app registration (SPA, personal Microsoft accounts).
// Leave empty to run in demo mode (data kept only in this browser).
window.CHECKLIST_CONFIG = {
  clientId: '66474cea-d6d9-4289-8dff-23d5950bd88f',
  authority: 'https://login.microsoftonline.com/consumers',
  dataPath: 'Checklist Sticky/checklist.json',   // path inside his OneDrive
  scopes: ['Files.ReadWrite'],
  pollSeconds: 15
};
