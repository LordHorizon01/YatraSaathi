import { Audio } from 'expo-av';

// ─── Audio Service ────────────────────────────────────────────────────────────
// Thin wrapper around expo-av. Handles permissions, recording lifecycle,
// and surfaces clean errors instead of raw expo exceptions.

let _recordingInstance = null;

/** Request mic permissions. Call once on app start. */
export async function requestAudioPermissions() {
  const { status } = await Audio.requestPermissionsAsync();
  if (status !== 'granted') {
    throw new Error('Microphone permission denied. Voice check-ins will not work.');
  }
  await Audio.setAudioModeAsync({
    allowsRecordingIOS:         true,
    playsInSilentModeIOS:       true,
    shouldDuckAndroid:          true,
    playThroughEarpieceAndroid: false,
  });
}

/**
 * Start recording. Returns a timestamp (epoch ms) for latency measurement.
 * Caller should store this and compute delta when stopRecording() is called.
 */
export async function startRecording() {
  if (_recordingInstance) {
    await _recordingInstance.stopAndUnloadAsync().catch(() => {});
    _recordingInstance = null;
  }

  const { recording } = await Audio.Recording.createAsync(
    Audio.RecordingOptionsPresets.HIGH_QUALITY,
  );
  _recordingInstance = recording;
  return Date.now(); // question-end timestamp
}

/**
 * Stop recording.
 * @returns {{ uri: string, durationMs: number }}
 */
export async function stopRecording(questionEndTimestamp) {
  if (!_recordingInstance) throw new Error('No active recording to stop.');

  const answerStartTimestamp = Date.now();
  await _recordingInstance.stopAndUnloadAsync();
  const uri = _recordingInstance.getURI();
  _recordingInstance = null;

  const latencyMs = answerStartTimestamp - questionEndTimestamp;
  return { uri, latencyMs };
}

/** Cancel and discard any in-progress recording. */
export async function cancelRecording() {
  if (_recordingInstance) {
    await _recordingInstance.stopAndUnloadAsync().catch(() => {});
    _recordingInstance = null;
  }
}
