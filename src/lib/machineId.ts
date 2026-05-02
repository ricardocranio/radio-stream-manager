export const getMachineId = async (): Promise<string> => {
  if (window.electronAPI && window.electronAPI.getMachineId) {
    return await window.electronAPI.getMachineId();
  }
  // Fallback for browser/dev mode
  let machineId = localStorage.getItem('pgm_machine_id');
  if (!machineId) {
    machineId = crypto.randomUUID();
    localStorage.setItem('pgm_machine_id', machineId);
  }
  return machineId;
};
