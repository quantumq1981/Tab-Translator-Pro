# Bach chorales — test fixtures only

338 four-part chorales by J. S. Bach (1685–1750), the ones with lyrics, copied unchanged from the
**music21** corpus (`music21/corpus/bach/*.mxl`, music21 10.5.2). The music and the German hymn texts are
in the public domain. The MusicXML encodings were contributed to music21 by their encoders; music21's
corpus licence says each encoding is distributed with the encoder's permission and that some corpus
encodings restrict commercial use.

They are here **only to test** the app's MusicXML lyric reader (`tests/bach-lyrics.mjs`). They are not
shipped with the app (nothing under `tests/` is deployed) and are not offered for sale.

`truth.json` is music21's own reading of each file's lyric part (bar index, offset in quarters, lyric
number, text, syllabic: s/b/m/e), written by `scripts/m21_lyrics_dump.py`.
