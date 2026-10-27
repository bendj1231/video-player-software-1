import Foundation

// vlcbridge — decodes a video with libVLC and streams scaled RGBA frames on stdout.
// Protocol: [0x46 'F', 0x52 'R', 0x4D 'M', 0x30 '0'] + u32le w + u32le h + w*h*4 RGBA
// stdin commands (one per line): pause | resume | seek <ms> | rate <f> | stop
// Audio is rendered by libVLC itself (coreaudio).

let args = CommandLine.arguments
guard args.count >= 2 else {
    FileHandle.standardError.write("usage: vlcbridge <file> [maxWidth]\n".data(using: .utf8)!)
    exit(2)
}
let filePath = args[1]
let maxW: UInt32 = args.count > 2 ? (UInt32(args[2]) ?? 960) : 960

func die(_ m: String) -> Never {
    FileHandle.standardError.write(("vlcbridge: " + m + "\n").data(using: .utf8)!)
    exit(1)
}

setenv("VLC_PLUGIN_PATH", "/Applications/VLC.app/Contents/MacOS/plugins", 1)
setenv("VLC_DATA_PATH", "/Applications/VLC.app/Contents/MacOS/share", 1)
guard let core = dlopen("/Applications/VLC.app/Contents/MacOS/lib/libvlccore.dylib", RTLD_NOW | RTLD_LOCAL) else {
    die("cannot load libvlccore (is VLC installed?)")
}
_ = core
guard let lib = dlopen("/Applications/VLC.app/Contents/MacOS/lib/libvlc.dylib", RTLD_NOW | RTLD_LOCAL) else {
    die("cannot load libvlc (is VLC installed?)")
}
func sym<T>(_ n: String, _ t: T.Type) -> T {
    guard let p = dlsym(lib, n) else { die("missing symbol \(n)") }
    return unsafeBitCast(p, to: t)
}

typealias P = UnsafeMutableRawPointer?
typealias F_new        = @convention(c) (Int32, UnsafePointer<UnsafePointer<Int8>?>?) -> P
typealias F_media_path = @convention(c) (P, UnsafePointer<Int8>?) -> P
typealias F_mp_media   = @convention(c) (P) -> P
typealias F_void       = @convention(c) (P) -> Void
typealias F_play       = @convention(c) (P) -> Int32
typealias F_setpause   = @convention(c) (P, Int32) -> Void
typealias F_settime    = @convention(c) (P, Int64) -> Void
typealias F_setrate    = @convention(c) (P, Float) -> Int32

typealias FormatCB = @convention(c) (UnsafeMutablePointer<P>?, UnsafeMutablePointer<Int8>?, UnsafeMutablePointer<UInt32>?, UnsafeMutablePointer<UInt32>?, UnsafeMutablePointer<UInt32>?, UnsafeMutablePointer<UInt32>?) -> UInt32
typealias CleanupCB = @convention(c) (P) -> Void
typealias LockCB = @convention(c) (P, UnsafeMutablePointer<P>?) -> P
typealias UnlockCB = @convention(c) (P, P, UnsafeMutablePointer<P>?) -> Void
typealias DisplayCB = @convention(c) (P, P) -> Void
typealias F_setfmt  = @convention(c) (P, FormatCB?, CleanupCB?) -> Void
typealias F_setcbs  = @convention(c) (P, LockCB?, UnlockCB?, DisplayCB?, P) -> Void

let vlcNew       = sym("libvlc_new", F_new.self)
let mediaNewPath = sym("libvlc_media_new_path", F_media_path.self)
let mpFromMedia  = sym("libvlc_media_player_new_from_media", F_mp_media.self)
let mediaRel     = sym("libvlc_media_release", F_void.self)
let mpRel        = sym("libvlc_media_player_release", F_void.self)
let vlcRel       = sym("libvlc_release", F_void.self)
let mpPlay       = sym("libvlc_media_player_play", F_play.self)
let mpSetPause   = sym("libvlc_media_player_set_pause", F_setpause.self)
let mpSetTime    = sym("libvlc_media_player_set_time", F_settime.self)
let mpSetRate    = sym("libvlc_media_player_set_rate", F_setrate.self)
let mpStop       = sym("libvlc_media_player_stop", F_void.self)
let setFormat    = sym("libvlc_video_set_format_callbacks", F_setfmt.self)
let setCbs       = sym("libvlc_video_set_callbacks", F_setcbs.self)

final class Ctx {
    var w: UInt32 = 0
    var h: UInt32 = 0
    var buf: UnsafeMutableRawPointer? = nil
    var lock = NSLock()
}
let ctx = Ctx()
let opaque = Unmanaged.passUnretained(ctx).toOpaque()
let out = FileHandle.standardOutput

func dbg(_ s: String) { FileHandle.standardError.write(("dbg: " + s + "\n").data(using: .utf8)!) }

let formatCB: FormatCB = { opaqueP, chromaP, widthP, heightP, pitchesP, linesP in
    let c = Unmanaged<Ctx>.fromOpaque(opaqueP!.pointee!).takeUnretainedValue()
    let chStr = String(bytes: [chromaP![0], chromaP![1], chromaP![2], chromaP![3]].map { UInt8(bitPattern: $0) }, encoding: .ascii) ?? "?"
    dbg("format src=\(widthP!.pointee)x\(heightP!.pointee) chroma=\(chStr)")
    let sw = widthP!.pointee, sh = heightP!.pointee
    // chroma "RV32" = R,G,B,A bytes — canvas ImageData-compatible
    // RV32 on little-endian = B,G,R,A in memory — we swap R/B before writing
    chromaP![0] = 0x52; chromaP![1] = 0x56; chromaP![2] = 0x33; chromaP![3] = 0x32
    var w = sw > maxW ? maxW : sw
    w = w & ~1
    var h = UInt32((Double(w) * Double(sh) / Double(sw)).rounded()) & ~1
    if h < 2 { h = 2 }
    widthP!.pointee = w
    heightP!.pointee = h
    pitchesP![0] = w * 4
    linesP![0] = h
    c.w = w
    c.h = h
    if c.buf != nil { free(c.buf); c.buf = nil }
    return 1
}
let cleanupCB: CleanupCB = { opaqueP in
    let c = Unmanaged<Ctx>.fromOpaque(opaqueP!).takeUnretainedValue()
    if c.buf != nil { free(c.buf); c.buf = nil }
}
var lockN = 0, dispN = 0
let lockCB: LockCB = { opaqueP, planesP in
    let c = Unmanaged<Ctx>.fromOpaque(opaqueP!).takeUnretainedValue()
    c.lock.lock()
    lockN += 1; if lockN < 3 { dbg("lock \(lockN) w=\(c.w)") }
    if c.buf == nil && c.w > 0 { c.buf = malloc(Int(c.w * c.h * 4)) }
    planesP![0] = c.buf
    return nil
}
let unlockCB: UnlockCB = { opaqueP, _, _ in
    let c = Unmanaged<Ctx>.fromOpaque(opaqueP!).takeUnretainedValue()
    c.lock.unlock()
}
var hdr = Data()
let displayCB: DisplayCB = { opaqueP, picture in
    let c = Unmanaged<Ctx>.fromOpaque(opaqueP!).takeUnretainedValue()
    c.lock.lock()
    defer { c.lock.unlock() }
    dispN += 1; if dispN < 3 { dbg("display \(dispN)") }
    guard let b = c.buf, c.w > 0, c.h > 0 else { dbg("display no-buf"); return }
    // throttle to ~15fps — stdout pipe + IPC can't sustain full-rate RGBA
    if dispN % 2 == 0 { return }
    let count = Int(c.w * c.h * 4)
    let px = b.assumingMemoryBound(to: UInt8.self)
    // swap R<->B: libVLC RV32 delivers B,G,R,A on little-endian; canvas wants RGBA
    var i = 0
    while i < count {
        let t = px[i]
        px[i] = px[i + 2]
        px[i + 2] = t
        i += 4
    }
    hdr.removeAll(keepingCapacity: true)
    hdr.append(contentsOf: [0x46, 0x52, 0x4D, 0x30])
    var w = c.w.littleEndian, h = c.h.littleEndian
    withUnsafeBytes(of: &w) { hdr.append(contentsOf: $0) }
    withUnsafeBytes(of: &h) { hdr.append(contentsOf: $0) }
    out.write(hdr)
    out.write(Data(bytes: b, count: count))
}

// libvlc instance
let argvStrings = ["vlcbridge", "--no-video-title-show", "--no-stats", "--vout=vmem", "--codec=avcodec", "--avcodec-hw=none"]
var cPtrs = argvStrings.map { strdup($0) }
let inst = cPtrs.withUnsafeBufferPointer { buf -> P in
    buf.baseAddress!.withMemoryRebound(to: UnsafePointer<Int8>?.self, capacity: cPtrs.count) {
        vlcNew(Int32(cPtrs.count), $0)
    }
}
guard inst != nil else { die("libvlc_new failed") }
let media = filePath.withCString { mediaNewPath(inst, $0) }
guard media != nil else { die("media_new_path failed for \(filePath)") }
guard let mp = mpFromMedia(media) else { die("media_player_new failed") }

setFormat(mp, formatCB, cleanupCB)
setCbs(mp, lockCB, unlockCB, displayCB, opaque)

// stdin command reader
Thread {
    while let line = readLine(strippingNewline: true) {
        let p = line.split(separator: " ")
        guard let cmd = p.first else { continue }
        switch cmd {
        case "pause":  mpSetPause(mp, 1)
        case "resume": mpSetPause(mp, 0)
        case "seek":   if p.count > 1, let ms = Int64(p[1]) { mpSetTime(mp, ms) }
        case "rate":   if p.count > 1, let r = Float(p[1]) { _ = mpSetRate(mp, r) }
        case "stop":   mpStop(mp); mpRel(mp); mediaRel(media); vlcRel(inst); exit(0)
        default: break
        }
    }
    mpStop(mp); mpRel(mp); mediaRel(media); vlcRel(inst); exit(0)
}.start()

let rc = mpPlay(mp)
if rc != 0 { die("play failed (\(rc))") }
FileHandle.standardError.write("vlcbridge: playing\n".data(using: .utf8)!)

RunLoop.main.run()
