"""The automatic facade reader: what a reviewer read off rectified photos, read by machine.

``kerbfront auto <model>`` takes a pipeline model (no observations), gathers every frame that
sees each street wall, poses them with Mapillary's solved rotations, registers them to each
other on the wall plane (camera errors along the wall and in height are pure shifts there),
fuses them, segments the fused elevation (UperNet/ADE20K, the model Kerbside's frontage filter
pins), and writes ``observations/auto/<id>.json`` in the same form as a reviewer's readings.
``kerbfront score`` compares it with the reviewer's readings and with the photos.
"""
