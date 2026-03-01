#!/usr/bin/env python3
from pathlib import Path
import argparse
import numpy as np
from scipy.io.wavfile import write as write_wav
import soundfile as sf
from transformers import AutoTokenizer, VitsModel
import torch


def main():
    parser = argparse.ArgumentParser(description="Run local MMS TTS and save audio")
    parser.add_argument("--model", default="facebook/mms-tts-tel")
    parser.add_argument("--lang", default="telugu")
    parser.add_argument("--text", default="")
    parser.add_argument("--format", default="wav", choices=["wav", "ogg", "opus"])
    parser.add_argument("--out", default="audio_storage/tts_questions/mms_tts_tel_local_test.wav")
    args = parser.parse_args()

    defaults = {
        "telugu": "నమస్కారం రైతు సర్వేకు స్వాగతం",
        "hindi": "नमस्ते किसान सर्वे में आपका स्वागत है",
        "kannada": "ನಮಸ್ಕಾರ ರೈತ ಸಮೀಕ್ಷೆಗೆ ಸ್ವಾಗತ",
        "english": "Hello and welcome to the farmer survey",
    }
    text = args.text.strip() if args.text else ""
    if not text:
        text = defaults.get(str(args.lang or "").strip().lower(), defaults["telugu"])

    out_file = Path(args.out)
    out_file.parent.mkdir(parents=True, exist_ok=True)

    print(f"Loading tokenizer/model: {args.model}")
    tokenizer = AutoTokenizer.from_pretrained(args.model)
    model = VitsModel.from_pretrained(args.model)

    inputs = tokenizer(text=text, return_tensors="pt")
    with torch.no_grad():
        waveform = model(**inputs).waveform

    audio = waveform.squeeze().cpu().numpy()
    if audio.dtype != np.float32:
        audio = audio.astype(np.float32)

    if args.format in ("ogg", "opus") or str(out_file.suffix).lower() in (".ogg", ".opus"):
        sf.write(str(out_file), audio, model.config.sampling_rate, format="OGG", subtype="OPUS")
        print(f"Saved OPUS/OGG: {out_file.resolve()}")
    else:
        write_wav(str(out_file), rate=model.config.sampling_rate, data=audio)
        print(f"Saved WAV: {out_file.resolve()}")
    print(f"Sample rate: {model.config.sampling_rate}")
    print(f"Samples: {audio.shape[0]}")


if __name__ == "__main__":
    main()
