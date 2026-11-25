#!/usr/bin/env bash
# Install the two programs the building-height fill runs (scripts/fill_building_heights.py):
#
#   3dfier 1.5.0  TU Delft's LoD1.2 lifter: the official macOS arm64 release (it bundles GDAL
#                 and PDAL, so nothing else is needed for it)
#   City3D        TU Delft's LoD2 reconstruction (Huang et al. 2022), built from source against
#                 Homebrew's CGAL, GMP and Boost, a core+imgproc-only OpenCV built here, and the
#                 SCIP solver City3D carries. Only the command-line program is built; its main()
#                 is patched to take the point cloud, the footprints and the output as arguments.
#
# Both are GPL-3.0 programs: they are run as separate processes, never linked into this code.
# Everything goes under $KERBSIDE_TOOLS (default ~/.kerbside-tools), outside the repository;
# the sources and build trees are deleted at the end (the disk is tight). Needs: brew install
# cmake cgal boost gmp.
#
#   bash scripts/install_building_tools.sh
set -euo pipefail
T="${KERBSIDE_TOOLS:-$HOME/.kerbside-tools}"
JOBS="${JOBS:-6}"
mkdir -p "$T/src" "$T/bin"

# ---- 3dfier ---------------------------------------------------------------------------------
if [ ! -x "$T/3dfier/3dfier-1.5.0-macos/bin/3dfier" ]; then
  curl -sfL -o "$T/src/3dfier.tar.gz" \
    https://github.com/tudelft3d/3dfier/releases/download/v1.5.0/3dfier-1.5.0-macos-arm64.tar.gz
  mkdir -p "$T/3dfier" && tar -xzf "$T/src/3dfier.tar.gz" -C "$T/3dfier" && rm "$T/src/3dfier.tar.gz"
fi
ln -sf "$T/3dfier/3dfier-1.5.0-macos/bin/3dfier" "$T/bin/3dfier"

# ---- OpenCV, core and imgproc only (all City3D asks of it) -----------------------------------
if [ ! -d "$T/opencv/lib" ]; then
  [ -f "$T/src/opencv.tar.gz" ] || curl -sfL -o "$T/src/opencv.tar.gz" \
    https://github.com/opencv/opencv/archive/refs/tags/4.10.0.tar.gz
  tar -xzf "$T/src/opencv.tar.gz" -C "$T/src"
  cmake -S "$T/src/opencv-4.10.0" -B "$T/src/opencv-build" -DCMAKE_BUILD_TYPE=Release \
    -DCMAKE_INSTALL_PREFIX="$T/opencv" -DBUILD_LIST=core,imgproc -DBUILD_SHARED_LIBS=ON \
    -DBUILD_TESTS=OFF -DBUILD_PERF_TESTS=OFF -DBUILD_EXAMPLES=OFF -DBUILD_opencv_apps=OFF \
    -DBUILD_opencv_python3=OFF -DWITH_IPP=OFF -DWITH_ITT=OFF -DWITH_OPENCL=OFF -DWITH_EIGEN=OFF \
    -DWITH_PROTOBUF=OFF -DWITH_FFMPEG=OFF -DWITH_OPENEXR=OFF -DWITH_JPEG=OFF -DWITH_PNG=OFF \
    -DWITH_TIFF=OFF -DWITH_WEBP=OFF -DWITH_OPENJPEG=OFF -DWITH_JASPER=OFF -DWITH_LAPACK=OFF > "$T/src/opencv-cmake.log"
  cmake --build "$T/src/opencv-build" -j "$JOBS" --target install > "$T/src/opencv-build.log"
  rm -rf "$T/src/opencv-4.10.0" "$T/src/opencv-build" "$T/src/opencv.tar.gz"
fi

# ---- City3D ----------------------------------------------------------------------------------
if [ ! -x "$T/bin/city3d" ]; then
  if [ ! -d "$T/src/City3D" ]; then
    git clone -q --depth 1 --filter=blob:none --sparse https://github.com/tudelft3d/City3D.git "$T/src/City3D"
    git -C "$T/src/City3D" sparse-checkout set --no-cone '/*' '!/data/' '!/images/'
  fi
  C="$T/src/City3D"
  # CGAL 6 needs C++17; City3D asks for C++11.
  sed -i '' 's/set(CMAKE_CXX_STANDARD 11)/set(CMAKE_CXX_STANDARD 17)/' "$C/code/CMakeLists.txt"
  # C++17 has no `register` (it was only ever a hint): its kd-tree's priority queue uses it.
  grep -rl --include='*.h' --include='*.cpp' -E '\bregister (int|unsigned|float|double)' "$C/code" \
    | while read -r f; do perl -pi -e 's/\bregister (?=(int|unsigned|float|double)\b)//g' "$f"; done
  # The example reads fixed files from the repository's data folder: take them as arguments
  # instead -- points (.ply/.las), footprints (.obj), output (.obj) -- and the two tuning
  # values the README names (minimum points per roof plane, pixel size in metres).
  M="$C/code/CLI_Example_1/main.cpp"
  if ! grep -q "argc < 4" "$M"; then
    perl -0pi -e 's/Method::min_points = 40;\s*Method::pixel_size = 0\.15;/if (argc < 4) { std::cerr << "usage: city3d points.ply footprints.obj out.obj [min_points] [pixel_size]" << std::endl; return 2; }\n    Method::min_points = argc > 4 ? std::atof(argv[4]) : 40;\n    Method::pixel_size = argc > 5 ? std::atof(argv[5]) : 0.15;/' "$M"
    perl -0pi -e 's/const std::string input_cloud_file = directory \+ "002\.ply";/const std::string input_cloud_file = argv[1];/; s/const std::string input_footprint_file = directory \+ "002_footprint\.obj";/const std::string input_footprint_file = argv[2];/; s/const std::string output_file = directory \+ "002_result\.obj";/const std::string output_file = argv[3];/' "$M"
    grep -q "argv\[1\]" "$M" || { echo "City3D's example changed: patch $M by hand" >&2; exit 1; }
  fi
  cmake -S "$C" -B "$C/Release" -DCMAKE_BUILD_TYPE=Release -DOpenCV_DIR="$T/opencv/lib/cmake/opencv4" > "$T/src/city3d-cmake.log"
  cmake --build "$C/Release" -j "$JOBS" --target CLI_Example_1 > "$T/src/city3d-build.log"
  exe=$(find "$C/Release" -type f -name CLI_Example_1 -perm -u+x | head -1)
  cp "$exe" "$T/bin/city3d"
  rm -rf "$C"
fi
echo "3dfier: $T/bin/3dfier"
echo "city3d: $T/bin/city3d"
du -sh "$T"
