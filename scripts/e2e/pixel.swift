import AppKit

let args = CommandLine.arguments
guard args.count == 4, let x = Int(args[2]), let y = Int(args[3]),
  let image = NSImage(contentsOfFile: args[1]),
  let cg = image.cgImage(forProposedRect: nil, context: nil, hints: nil)
else {
  FileHandle.standardError.write("usage: pixel <png> <x> <y>\n".data(using: .utf8)!)
  exit(64)
}

let rep = NSBitmapImageRep(cgImage: cg)
guard let color = rep.colorAt(x: x, y: y)?.usingColorSpace(.sRGB) else { exit(65) }
print("\(cg.width) \(cg.height) \(Int(color.redComponent * 255)) \(Int(color.greenComponent * 255)) \(Int(color.blueComponent * 255))")
