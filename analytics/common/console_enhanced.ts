function formatDateTime() {
  const now = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
  const dateParts = now.split(',')[0].split('/').map(part => part.padStart(2, '0'));
  const timeParts = now.split(',')[1].trim().split(':').map(part => part.padStart(2, '0'));
  // en-IN locale produces dd/mm/yyyy format
  return `${dateParts[2]}/${dateParts[1]}/${dateParts[0]} ${timeParts[0]}:${timeParts[1]}:${timeParts[2]}`;
}

const originalLog = console.log;
console.log = (...args) => originalLog(`[${formatDateTime()}]`, ...args);

const originalError = console.error;
console.error = (...args) => originalError(`[${formatDateTime()}]`, ...args);
