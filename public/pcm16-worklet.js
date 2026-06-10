/**
 * pcm16-worklet — resamples mic audio to 16 kHz mono and emits Int16 PCM
 * frames (~100ms) to the main thread for the Sarvam streaming relay.
 * `sampleRate` is the AudioContext rate (global in the worklet scope).
 */
class PCM16Worklet extends AudioWorkletProcessor {
  constructor() {
    super();
    this.targetRate = 16000;
    this.ratio = sampleRate / this.targetRate; // e.g. 48000/16000 = 3
    this.acc = 0;
    this.buf = [];
  }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    for (let i = 0; i < ch.length; i++) {
      this.acc += 1;
      if (this.acc >= this.ratio) {
        this.acc -= this.ratio;
        let s = ch[i];
        if (s > 1) s = 1; else if (s < -1) s = -1;
        this.buf.push(s < 0 ? s * 0x8000 : s * 0x7fff);
      }
    }
    if (this.buf.length >= 1600) { // ~100ms @16k
      const out = new Int16Array(this.buf.splice(0, this.buf.length));
      this.port.postMessage(out.buffer, [out.buffer]);
    }
    return true;
  }
}
registerProcessor("pcm16-worklet", PCM16Worklet);
