export function rms(pcm) {
  if (!pcm?.length) return 0;
  let sum = 0;
  for (const sample of pcm) {
    const normalized = sample / 32768;
    sum += normalized * normalized;
  }
  return Math.sqrt(sum / pcm.length);
}

export function int16ToFloat32(pcm) {
  const out = new Float32Array(pcm.length);
  for (let i = 0; i < pcm.length; i += 1) {
    out[i] = pcm[i] / 32768;
  }
  return out;
}

export function peakAmplitude(pcm) {
  if (!pcm?.length) return 0;
  let peak = 0;
  for (const sample of pcm) {
    const abs = Math.abs(sample) / 32768;
    if (abs > peak) peak = abs;
  }
  return peak;
}

export function padSilence(pcm, { sampleRate = 16_000, padMs = 300 } = {}) {
  const pad = Math.max(0, Math.round((sampleRate * padMs) / 1000));
  if (!pcm?.length || pad === 0) return pcm;
  const out = new Int16Array(pcm.length + pad * 2);
  out.set(pcm, pad);
  return out;
}

export function normalizePeak(pcm, { target = 0.85, minPeak = 0.005 } = {}) {
  const peak = peakAmplitude(pcm);
  if (peak < minPeak || peak >= target) return pcm;
  const gain = target / peak;
  const out = new Int16Array(pcm.length);
  for (let i = 0; i < pcm.length; i += 1) {
    const scaled = Math.round(pcm[i] * gain);
    out[i] = Math.max(-32768, Math.min(32767, scaled));
  }
  return out;
}

export function prepareAudioForWhisper(pcm) {
  return normalizePeak(padSilence(pcm));
}

export function concatInt16(chunks) {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Int16Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

export function createNoiseGate({
  minThreshold = 0.012,
  maxThreshold = 0.045,
  multiplier = 3.2,
  offset = 0.006,
  window = 160,
} = {}) {
  const samples = [];
  return {
    observe(value) {
      samples.push(value);
      if (samples.length > window) samples.shift();
    },
    floor() {
      if (samples.length < 15) return 0;
      const sorted = [...samples].sort((a, b) => a - b);
      return sorted[Math.floor(sorted.length * 0.3)];
    },
    threshold() {
      const floor = this.floor();
      if (floor === 0) return minThreshold;
      return Math.min(maxThreshold, Math.max(minThreshold, floor * multiplier + offset));
    },
  };
}

export function thresholdFromProbe({ avg, peak, fallback = 0.001 }) {
  const noise = Math.max(Number(avg) || 0, Number(peak) || 0, 0);
  if (noise < 0.0003) return fallback;
  return Math.min(0.008, Math.max(fallback, noise * 5 + 0.0006));
}

export function captureShouldStop({
  elapsedMs,
  silenceMs,
  silenceThresholdMs,
  minCaptureMs = 0,
  maxCaptureMs,
  heardSpeech,
  currentRms,
  speechRmsThreshold,
}) {
  if (elapsedMs < minCaptureMs) return null;
  if (elapsedMs >= maxCaptureMs) return "max";
  if (
    heardSpeech &&
    currentRms < speechRmsThreshold &&
    silenceMs >= silenceThresholdMs
  ) {
    return "silence";
  }
  return null;
}
