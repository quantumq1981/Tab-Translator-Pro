#!/usr/bin/env bash
# Fonts the chord recogniser was trained with (rendering training images only — none ships with the app).
# All SIL Open Font License 1.1, except Permanent Marker, Coming Soon and Schoolbell (Apache License 2.0).
# Kalam and Schoolbell are HELD OUT: synth.py never trains on them (with Liberation Serif, the system
# font verovio's text falls back to, they are the evaluation fonts). Also used from the system:
# DejaVu Sans/Serif, FreeSerif/FreeSans, Liberation Sans (♯ ♭ glyphs and plain text faces).
set -euo pipefail
mkdir -p "${1:-fonts}" && cd "${1:-fonts}"
G=https://raw.githubusercontent.com/google/fonts/main
get() { curl -sSfL -o "$2" "$1"; echo "$2"; }
get "$G/ofl/patrickhand/PatrickHand-Regular.ttf" PatrickHand-Regular.ttf
get "$G/ofl/kalam/Kalam-Regular.ttf" Kalam-Regular.ttf
get "$G/ofl/caveat/Caveat%5Bwght%5D.ttf" Caveat.ttf
get "$G/ofl/architectsdaughter/ArchitectsDaughter-Regular.ttf" ArchitectsDaughter.ttf
get "$G/ofl/gochihand/GochiHand-Regular.ttf" GochiHand.ttf
get "$G/ofl/indieflower/IndieFlower-Regular.ttf" IndieFlower.ttf
get "$G/ofl/shadowsintolight/ShadowsIntoLight.ttf" ShadowsIntoLight.ttf
get "$G/ofl/reeniebeanie/ReenieBeanie.ttf" ReenieBeanie.ttf
get "$G/apache/permanentmarker/PermanentMarker-Regular.ttf" PermanentMarker.ttf
get "$G/ofl/merriweather/Merriweather%5Bopsz,wdth,wght%5D.ttf" Merriweather.ttf
get "$G/ofl/lato/Lato-Regular.ttf" Lato.ttf
get "$G/ofl/lato/Lato-Bold.ttf" LatoBold.ttf
get "$G/ofl/ptserif/PT_Serif-Web-Regular.ttf" PTSerif.ttf
get "$G/ofl/crimsontext/CrimsonText-Regular.ttf" CrimsonText.ttf
get "$G/ofl/courierprime/CourierPrime-Regular.ttf" CourierPrime.ttf
get "$G/ofl/oswald/Oswald%5Bwght%5D.ttf" Oswald.ttf
get "$G/ofl/ebgaramond/EBGaramond%5Bwght%5D.ttf" EBGaramond.ttf
get "$G/ofl/handlee/Handlee-Regular.ttf" Handlee.ttf
get "$G/ofl/neucha/Neucha.ttf" Neucha.ttf
get "$G/apache/comingsoon/ComingSoon-Regular.ttf" ComingSoon.ttf
get "$G/apache/schoolbell/Schoolbell-Regular.ttf" Schoolbell.ttf
get "$G/ofl/sriracha/Sriracha-Regular.ttf" Sriracha.ttf
get "$G/ofl/itim/Itim-Regular.ttf" Itim.ttf
# Steinberg's jazz-handwriting text font (SMuFL companion), SIL OFL 1.1
get "https://raw.githubusercontent.com/steinbergmedia/petaluma/master/redist/otf/PetalumaScript.otf" PetalumaScript.otf
