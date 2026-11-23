// The faces in pictures, for scripts/pictures.ts: macOS's own face detection (Vision), so no
// library is added. For each file given, one line of JSON: the picture's size and every face in it,
// its box as shares of the picture (from the top left), how sure Vision is that it is a face, and
// how good a capture of a face it is (sharp, lit, looking at the camera: 0 to 1), which is how the
// best of a player's photos is picked.
//
//   swift scripts/faces.swift a.jpg b.jpg …

import Foundation
import Vision
import ImageIO

struct Face: Encodable {
  let x: Double
  let y: Double
  let w: Double
  let h: Double
  let confidence: Double
  let quality: Double
}

struct Result: Encodable {
  let file: String
  let width: Int
  let height: Int
  let faces: [Face]
}

let encoder = JSONEncoder()
for path in CommandLine.arguments.dropFirst() {
  let url = URL(fileURLWithPath: path)
  guard let source = CGImageSourceCreateWithURL(url as CFURL, nil), let image = CGImageSourceCreateImageAtIndex(source, 0, nil) else {
    print("{\"file\":\"\(path)\",\"width\":0,\"height\":0,\"faces\":[]}")
    continue
  }
  let handler = VNImageRequestHandler(cgImage: image, options: [:])
  let detect = VNDetectFaceRectanglesRequest()
  let quality = VNDetectFaceCaptureQualityRequest()
  try? handler.perform([detect])
  let found = detect.results ?? []
  quality.inputFaceObservations = found
  try? handler.perform([quality])
  let rated = quality.results ?? found
  // Vision's boxes are from the bottom left; the script wants them from the top left, as a canvas has them.
  let faces = rated.map { f in
    Face(x: f.boundingBox.minX, y: 1 - f.boundingBox.maxY, w: f.boundingBox.width, h: f.boundingBox.height, confidence: Double(f.confidence), quality: Double(f.faceCaptureQuality ?? 0))
  }
  let result = Result(file: path, width: image.width, height: image.height, faces: faces)
  if let data = try? encoder.encode(result), let line = String(data: data, encoding: .utf8) { print(line) }
}
