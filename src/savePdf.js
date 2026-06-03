/**
 * savePdf(pdf, filename)
 *
 * On web:     uses jsPDF's built-in pdf.save() (browser download)
 * On Android (Capacitor): writes to the public Downloads directory,
 *             then opens it with the Android file viewer via Share plugin.
 */

import { Capacitor } from "@capacitor/core";

export async function savePdf(pdf, filename) {
  if (!Capacitor.isNativePlatform()) {
    // Plain browser — standard jsPDF download
    pdf.save(filename);
    return;
  }

  // Android / native Capacitor path
  try {
    // Lazy-load to avoid bundling native code on web builds
    const { Filesystem, Directory } = await import("@capacitor/filesystem");
    const { Share } = await import("@capacitor/share");

    // Get the PDF as a base64 string
    const base64 = pdf.output("datauristring").split(",")[1];

    // Write to the app's external Documents directory (always accessible,
    // no WRITE_EXTERNAL_STORAGE permission needed on Android 10+)
    const result = await Filesystem.writeFile({
      path: filename,
      data: base64,
      directory: Directory.Documents,
      recursive: true,
    });

    // Open the file so the user can view / save / share it
    await Share.share({
      title: filename,
      url: result.uri,
      dialogTitle: "Open or save PDF",
    });
  } catch (err) {
    console.error("savePdf native error:", err);
    // Fallback: try the browser-style download anyway
    pdf.save(filename);
  }
}
