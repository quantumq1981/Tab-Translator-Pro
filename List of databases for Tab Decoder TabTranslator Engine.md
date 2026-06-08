This document presents a comprehensive list of databases and lookup tables required to meet all specified requirements, prepared for integration into your technical specifications.

Required Data Stores and Lookup Tables:

1. Tuning Presets Database
- Type: Static embedded table (JSON, YAML, or hardcoded dictionary)
- Purpose: Associates tuning names (e.g., "Standard", "Drop D", "Open G") with arrays of open-string MIDI pitches or string index to MIDI note mappings. It is utilized by the fret-to-pitch converter to initialize the tuning map.
- Example: "Standard_6": [40, 45, 50, 55, 59, 64]

2. Note Naming Database
- Type: Static lookup table (embedded dictionary)
- Purpose: Converts MIDI pitch classes (0–11) into human-readable note names (e.g., 1 → ["C#", "Db"]). Supports user preferences for sharps or flats and displays chord roots, bass notes, and slash suffixes.
- Structure: pitch_class_to_name = {0: "C", 1: "C#/Db"} with separate mappings based on user preferences.

3. Chord Quality Pattern Database
- Type: Core recognition hash table (bitmask to quality metadata)
- Purpose: Stores interval bitmasks, quality labels (e.g., "Major"), suffix strings ("", "m", "7", "sus4"), and optional interval lists for supported chord types. It enables matching transposed pitch‑class sets to known chord formulas.
- Examples: Major triad (0,4,7) maps to mask 0b000010010001; Minor seventh (0,3,7,10) maps to mask 0b000010001101.

4. Chord Quality Ranking and Precedence Table
- Type: Ordered or weighted list (embedded)
- Purpose: Assists in resolving ambiguities by prioritizing chord qualities according to cultural prevalence (e.g., Major over Minor, seventh, sus4). It guides the parser to select the most common interpretation.
- Format: A prioritized array of quality keys.

5. Harmonic Intervals Database (Optional)
- Type: Lookup table (embedded)
- Purpose: When natural harmonic detection is enabled, maps fret numbers to the corresponding harmonic intervals in semitones above the open string. This accounts for harmonics at specific frets, such as fret 7 which sounds an octave plus fifth, not the standard fretted pitch.
- Example: {5: 28, 7: 19, 12: 12, 19: 28} (semitones above open string).

6. User Configuration Store
- Type: Local persistent file (JSON, INI, or user‑editable text)
- Purpose: Stores runtime settings such as tuning selection, capo fret, pitch preference (sharp/flat), confidence thresholds, penalty weights, and user-defined chord quality overrides. Loaded at startup to customize parser behavior.

7. Diatonic Context Database (Optional)
- Type: Static rule set or key signature table
- Purpose: Supports key-awareness by storing diatonic pitch‑class sets and common chord qualities for all 24 major and minor keys. Facilitates the resolver in prioritizing roots and qualities consistent with the song’s key, thereby reducing false slash chords.

8. External Chord Recognition Service and Library Adapter (Optional)
- Type: Runtime API or local library interface (e.g., Chordino, Autochord)
- Purpose: Acts as a fallback or alternative scoring mechanism. It can be integrated via an adapter, accepting the same input (pitch‑class set, bass note) and returning one or more chord hypotheses with confidence levels. While not a traditional database, it functions as a knowledge base accessed during processing.

All components except the optional external service are designed to be self-contained and included with the application, ensuring that the tool remains offline and highly responsive.