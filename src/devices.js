/**
 * Audio output device enumeration and selection.
 *
 * Note: Changing the output for YouTube iframes is limited by cross-origin
 * browser policies. The dropdown still shows available devices for reference.
 */

const selectEl = document.getElementById('output-device');

export async function initDeviceSelector() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
    selectEl.innerHTML = '<option value="">Not supported</option>';
    return;
  }

  try {
    // Request mic access to unlock full device enumeration
    await navigator.mediaDevices.getUserMedia({ audio: true })
      .then((stream) => {
        // Stop tracks immediately — we just needed the permission
        stream.getTracks().forEach((t) => t.stop());
      })
      .catch(() => {
        // User denied — we'll still show "Default"
      });

    await refreshDevices();

    // Re-enumerate when devices change (e.g. headphones plugged in)
    navigator.mediaDevices.addEventListener('devicechange', refreshDevices);
  } catch {
    // Silently fall back to Default only
  }
}

async function refreshDevices() {
  const devices = await navigator.mediaDevices.enumerateDevices();
  const outputs = devices.filter((d) => d.kind === 'audiooutput');

  // Preserve current selection
  const current = selectEl.value;

  selectEl.innerHTML = '';

  if (outputs.length === 0) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = 'Default';
    selectEl.appendChild(opt);
    return;
  }

  outputs.forEach((device, i) => {
    const opt = document.createElement('option');
    opt.value = device.deviceId;
    opt.textContent = device.label || `Speaker ${i + 1}`;
    selectEl.appendChild(opt);
  });

  // Restore previous selection if still available
  if (current && [...selectEl.options].some((o) => o.value === current)) {
    selectEl.value = current;
  }
}
