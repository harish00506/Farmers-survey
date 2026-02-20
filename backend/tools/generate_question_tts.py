#!/usr/bin/env python3
"""
Deprecated tool: question TTS generator removed.

This project uses ElevenLabs for TTS. For single-item TTS, use the admin endpoint:
  POST /api/tts (admin) with { text, lang, voice, format }

If you need a bulk TTS generation script for ElevenLabs, ask and I will add one.
"""

import os
import sys
import argparse
import time
import random
import string
from datetime import datetime
from urllib.parse import urlencode

import requests
from pymongo import MongoClient
from dotenv import load_dotenv


def make_id(prefix='tts'):
    return f"{prefix}_{int(time.time()*1000)}_{''.join(random.choices(string.ascii_lowercase+string.digits, k=6))}"


def synthesize_text_coqui(*args, **kwargs):
    raise RuntimeError('generate_question_tts.py is deprecated. Use the admin POST /api/tts endpoint for ElevenLabs synthesize tasks or request a new bulk generator for ElevenLabs.')


def ensure_dir(path):
    os.makedirs(path, exist_ok=True)
    return path


def load_questions(db, ids=None):
    coll = db.get_collection('questions')
    if ids:
        query = {'id': {'$in': ids}}
    else:
        query = {}
    docs = list(coll.find(query))
    return docs


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--question-ids', help='Comma-separated question ids to (re)generate', default=None)
    parser.add_argument('--force', help='Regenerate even if file exists', action='store_true')
    parser.add_argument('--dry-run', help="Don't write files or DB; just show actions", action='store_true')
    # Deprecated Coqui-specific args removed; this tool is deprecated.
    args = parser.parse_args()

    # load env
    load_dotenv()

    print('This tool is deprecated. Use POST /api/tts (admin) to synthesize single TTS files via ElevenLabs, or request a bulk generator.')
    sys.exit(0)

    # Connect Mongo
    client = MongoClient(MONGODB_URI)
    db = client[MONGODB_DB_NAME]

    ids = None
    if args.question_ids:
        ids = args.question_ids.split(',')

    questions = load_questions(db, ids)
    if not questions:
        print('No questions found. Exiting.')
        sys.exit(0)

    audio_coll = db.get_collection('audio')

    created = 0
    skipped = 0
    failed = 0

    for q in questions:
        qid = q.get('id') or str(q.get('_id'))
        text = q.get('text') or q.get('question') or ''
        if not text or not text.strip():
            print(f"Skipping question {qid}: empty text")
            skipped += 1
            continue

        out_fname = f"question_{qid}.wav"
        out_path = os.path.join(out_dir, out_fname)

        if os.path.exists(out_path) and not args.force:
            print(f"Skipping existing file for question {qid}: {out_path}")
            skipped += 1
            continue

        print(f"Synthesizing question {qid} ...")
        try:
            raise RuntimeError('Deprecated: this tool is replaced by admin /api/tts. Request a new generator if you need bulk TTS for ElevenLabs')
            if args.dry_run:
                print(f"[dry-run] would write {len(audio_bytes)} bytes to {out_path}")
                created += 1
                continue

            # Write file
            with open(out_path, 'wb') as f:
                f.write(audio_bytes)

            file_size = os.path.getsize(out_path)
            audio_id = make_id('tts')

            # Insert audio doc
            audio_doc = {
                'id': audio_id,
                'fileName': out_fname,
                'filePath': out_path.replace('\\\\', '/'),
                'mimeType': 'audio/wav',
                'fileSize': file_size,
                'source': 'tts',
                'sourceText': text,
                'lang': q.get('lang') or None,
                'questionId': qid,
                'createdAt': datetime.utcnow(),
                'transcriptionStatus': 'not_requested'
            }

            if not args.dry_run:
                # upsert if a tts audio for this question already exists
                audio_coll.update_one({'questionId': qid, 'source': 'tts'}, {'$set': audio_doc}, upsert=True)

            print(f"Saved TTS for question {qid}: {out_path} ({file_size} bytes)")
            created += 1
        except Exception as e:
            print(f"ERROR: Failed to synthesize question {qid}: {e}")
            failed += 1

    print('---')
    print(f'Processed: {len(questions)}, created: {created}, skipped: {skipped}, failed: {failed}')
    client.close()


if __name__ == '__main__':
    main()
