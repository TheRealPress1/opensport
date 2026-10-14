import AppKit

let size = 1024
let bitmap = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: size, pixelsHigh: size, bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: bitmap)
let scale = CGFloat(size) / 40
let transform = AffineTransform(scale: scale)
(transform as NSAffineTransform).concat()
NSColor(calibratedRed: 22/255, green: 61/255, blue: 49/255, alpha: 1).setFill()
NSBezierPath(roundedRect: NSRect(x: 1, y: 1, width: 38, height: 38), xRadius: 9, yRadius: 9).fill()
NSColor(calibratedRed: 247/255, green: 246/255, blue: 239/255, alpha: 1).setFill()
let stripe = NSBezierPath()
stripe.move(to: NSPoint(x: 8, y: 10)); stripe.line(to: NSPoint(x: 21, y: 32)); stripe.line(to: NSPoint(x: 32, y: 32)); stripe.line(to: NSPoint(x: 19, y: 10)); stripe.close(); stripe.fill()
NSColor(calibratedRed: 239/255, green: 172/255, blue: 128/255, alpha: 1).setFill()
let wedge = NSBezierPath()
wedge.move(to: NSPoint(x: 26, y: 9)); wedge.line(to: NSPoint(x: 35, y: 25)); wedge.line(to: NSPoint(x: 35, y: 9)); wedge.close(); wedge.fill()
NSGraphicsContext.restoreGraphicsState()
try bitmap.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: CommandLine.arguments[1]))
