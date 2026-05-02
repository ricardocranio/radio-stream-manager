export const getMachineId = async (): Promise<string> => {
  if (window.electron && window.electron.getMachineId) {
    return await window.electron.getMachineId();
  }
  // Fallback for browser/dev mode
  let machineId = localStorage.getItem('pgm_machine_id');
  if (!machineId) {
    machineId = crypto.randomUUID();
    localStorage.setItem('pgm_machine_id', machineId);
  }
  return machineId;
};
