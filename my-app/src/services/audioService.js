import { Audio } from 'expo-av';

// ─── Audio Service ────────────────────────────────────────────────────────────
// Thin wrapper around expo-av. Handles permissions, recording lifecycle,
// and surfaces clean errors instead of raw expo exceptions.

let _recordingInstance = null;
let _recordingStartTime = null;

/**
 * Start recording. Returns a timestamp (epoch ms) for latency measurement.
 */
export async function startRecording() {
  // Clean up any stale instance
  if (_recordingInstance) {
    try { await _recordingInstance.stopAndUnloadAsync(); } catch (_) {}
    _recordingInstance = null;
  }

  // Request mic permission (no-ops if already granted)
  const { status } = await Audio.requestPermissionsAsync();
  if (status !== 'granted') {
    throw new Error('Microphone permission denied. Please enable it in Settings.');
  }

  await Audio.setAudioModeAsync({
    allowsRecordingIOS:         true,
    playsInSilentModeIOS:       true,
    shouldDuckAndroid:          true,
    playThroughEarpieceAndroid: false,
  });

  const { recording } = await Audio.Recording.createAsync(
    Audio.RecordingOptionsPresets.HIGH_QUALITY,
  );
  _recordingInstance = recording;
  _recordingStartTime = Date.now();
  console.log('[Saarthi] Recording started');
  return _recordingStartTime;
}

/**
 * Stop recording. Returns { uri, latencyMs }.
 * If no active recording, returns a safe fallback instead of throwing.
 */
export async function stopRecording(questionEndTimestamp) {
  if (!_recordingInstance) {
    console.warn('[Saarthi] No active recording — returning fallback');
    return { uri: null, latencyMs: Date.now() - (questionEndTimestamp || Date.now()) };
  }

  const latencyMs = Date.now() - (questionEndTimestamp || _recordingStartTime || Date.now());

  try {
    await _recordingInstance.stopAndUnloadAsync();
  } catch (e) {
    console.warn('[Saarthi] stopAndUnloadAsync failed:', e.message);
  }

  const uri = _recordingInstance.getURI();
  console.log('[Saarthi] Recording stopped, URI:', uri);
  _recordingInstance = null;
  _recordingStartTime = null;

  return { uri, latencyMs };
}

/** Cancel and discard any in-progress recording. */
export async function cancelRecording() {
  if (_recordingInstance) {
    try { await _recordingInstance.stopAndUnloadAsync(); } catch (_) {}
    _recordingInstance = null;
    _recordingStartTime = null;
  }
}
