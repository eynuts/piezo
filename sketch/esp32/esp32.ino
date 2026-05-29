#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <WebServer.h>
#include <DNSServer.h>
#include <Preferences.h>
#include <time.h>

// NTP settings
const char* NTP_SERVER    = "pool.ntp.org";
const long  GMT_OFFSET_SEC = 8 * 3600;  // UTC+8 (Philippines) — adjust to your timezone
const int   DAYLIGHT_OFFSET_SEC = 0;

const char FIREBASE_HOST[] = "piezo-6375a-default-rtdb.asia-southeast1.firebasedatabase.app";
const char FIREBASE_PATH[] = "/serialInputs.json"; // change path if needed
const char FIREBASE_BATTERY_PATH[] = "/battery.json"; // battery voltage path

WiFiClientSecure client;
WebServer server(80);
DNSServer dnsServer;
Preferences preferences;

// AP indicator LED (on many ESP32 dev boards the on-board LED is on GPIO 2)
const int AP_LED_PIN = 2;
const char AP_SSID[] = "ESP32-Setup";
const char AP_PASSWORD[] = "12345678";
const int CONNECT_TIMEOUT_MS = 30000;

String savedSSID = "";
String savedPassword = "";
String statusMessage = "";
String lastConnectSSID = "";
bool isConnecting = false;
unsigned long connectStartMs = 0;

// Helper to print to both USB Serial and the serial link to the UNO
void dualPrint(const String &s) {
  Serial.print(s);
  Serial2.print(s);
}

void dualPrintln(const String &s) {
  Serial.println(s);
  Serial2.println(s);
}

String escapeJson(const String &s) {
  String escaped = "";
  for (size_t i = 0; i < s.length(); i++) {
    char c = s[i];
    switch (c) {
      case '"': escaped += "\\\""; break;
      case '\\': escaped += "\\\\"; break;
      case '\b': escaped += "\\b"; break;
      case '\f': escaped += "\\f"; break;
      case '\n': escaped += "\\n"; break;
      case '\r': escaped += "\\r"; break;
      case '\t': escaped += "\\t"; break;
      default: escaped += c; break;
    }
  }
  return escaped;
}

unsigned long getCurrentTimestampMs() {
  time_t now = time(nullptr);
  if (now <= 0) {
    return millis();
  }
  return (unsigned long)now * 1000UL + (millis() % 1000UL);
}

String getCurrentDatetime() {
  struct tm timeinfo;
  if (!getLocalTime(&timeinfo)) {
    return "";
  }
  char buf[32];
  sprintf(buf, "%04d-%02d-%02d %02d:%02d:%02d",
          timeinfo.tm_year + 1900,
          timeinfo.tm_mon + 1,
          timeinfo.tm_mday,
          timeinfo.tm_hour,
          timeinfo.tm_min,
          timeinfo.tm_sec);
  return String(buf);
}

const int ESP32_RX_PIN = 16; // ESP32 receives from UNO TX
const int ESP32_TX_PIN = 17; // ESP32 sends to UNO RX
String serial2Buffer = "";
String inputBuffer = "";

bool writeToFirebase(const String &value) {
  if (WiFi.status() != WL_CONNECTED) {
    dualPrintln("Wi-Fi not connected");
    return false;
  }

  HTTPClient https;
  client.setInsecure();
  https.setConnectTimeout(5000);  // 5 second connect timeout
  https.setTimeout(5000);         // 5 second read timeout

  String url = String("https://") + FIREBASE_HOST + FIREBASE_PATH;
  https.begin(client, url);
  https.addHeader("Content-Type", "application/json");

  unsigned long tsMs = getCurrentTimestampMs();
  String datetime = getCurrentDatetime();
  String payload = "{\"text\":\"" + escapeJson(value) + "\","
                   "\"timestamp\":" + String(tsMs) + ","
                   "\"datetime\":\"" + escapeJson(datetime) + "\"}";
  dualPrint("Posting to Firebase... ");
  dualPrintln(url);
  int httpCode = https.POST(payload);

  if (httpCode > 0) {
    dualPrint("Firebase response code: ");
    dualPrintln(String(httpCode));
    String response = https.getString();
    dualPrint("Response: ");
    dualPrintln(response);
  } else {
    dualPrint("Firebase POST failed: ");
    dualPrintln(https.errorToString(httpCode));
  }

  https.end();
  return (httpCode == HTTP_CODE_OK || httpCode == HTTP_CODE_CREATED);
}

bool writeBatteryToFirebase(const String &voltage, const String &percent) {
  if (WiFi.status() != WL_CONNECTED) return false;

  HTTPClient https;
  client.setInsecure();
  https.setConnectTimeout(5000);
  https.setTimeout(5000);

  String url = String("https://") + FIREBASE_HOST + FIREBASE_BATTERY_PATH;
  https.begin(client, url);
  https.addHeader("Content-Type", "application/json");

  String payload = "{\"voltage\":" + voltage + ",\"percent\":" + percent + ",\"timestamp\":" + String(millis()) + "}";
  int httpCode = https.PUT(payload); // PUT to overwrite with latest reading

  https.end();
  return (httpCode == HTTP_CODE_OK);
}

void loadCredentials() {
  preferences.begin("wifi-config", false);
  savedSSID = preferences.getString("ssid", "");
  savedPassword = preferences.getString("pass", "");
  preferences.end();
}

void saveCredentials(const String &ssid, const String &pass) {
  preferences.begin("wifi-config", false);
  preferences.putString("ssid", ssid);
  preferences.putString("pass", pass);
  preferences.end();
  savedSSID = ssid;
  savedPassword = pass;
}

void startConnection(const String &ssid, const String &pass) {
  lastConnectSSID = ssid;
  WiFi.disconnect(true);
  delay(100);
  WiFi.begin(ssid.c_str(), pass.c_str());
  connectStartMs = millis();
  isConnecting = true;
  statusMessage = "Connecting to " + ssid + "...";
  dualPrintln(statusMessage);
  dualPrint("Attempting SSID: ");
  dualPrintln(ssid);
}

String getCurrentWiFiStatus() {
  if (WiFi.status() == WL_CONNECTED) {
    return "Connected to " + WiFi.SSID() + " (" + WiFi.localIP().toString() + ")";
  }

  if (isConnecting) {
    return statusMessage;
  }

  if (savedSSID.length() > 0) {
    return "Saved Wi-Fi: " + savedSSID + " (not connected)";
  }

  return "No saved Wi-Fi. Use the portal to choose a network.";
}

String buildPortalPage() {
  Serial.println(">>> BUILD PORTAL PAGE CALLED");
  dualPrintln("Scanning Wi-Fi networks...");

  Serial.println(">>> Starting WiFi scan...");
  // Do a blocking scan and include hidden networks
  int networks = WiFi.scanNetworks(false, true);
  Serial.println(">>> Scan complete");
  dualPrint("Initial scan count: ");
  dualPrintln(String(networks));

  // If nothing found, try an asynchronous scan and wait briefly for results
  if (networks <= 0) {
    dualPrintln("No networks found on initial scan — retrying (async)...");
    WiFi.scanNetworks(true, true); // start async scan
    unsigned long start = millis();
    int scanCount = -2;
    while (millis() - start < 3000) {
      scanCount = WiFi.scanComplete();
      if (scanCount >= 0) break;
      delay(200);
    }
    if (scanCount >= 0) {
      networks = scanCount;
    }
    dualPrint("Async scan result: ");
    dualPrintln(String(networks));
  }

  String wifiList = "";
  if (networks <= 0) {
    wifiList = "<option value=''>No networks found</option>";
  } else {
    for (int i = 0; i < networks; i++) {
      String ssid = WiFi.SSID(i);
      wifiList += "<option value='" + ssid + "'>" + ssid + "</option>";
    }
  }

  String html = "<!DOCTYPE html><html><head><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'>";
  html += "<title>ESP32 Wi-Fi Portal</title>";
  html += "<style>body{font-family:Arial,sans-serif;margin:20px;}label{display:block;margin-top:12px;font-weight:bold;}input,select{width:100%;padding:10px;margin-top:8px;box-sizing:border-box;}button{margin-top:16px;padding:10px 18px;font-size:16px;}p{margin:8px 0;}code{background:#f2f2f2;padding:2px 6px;border-radius:4px;}.card{border:1px solid #ddd;border-radius:8px;padding:12px;margin-top:16px;}</style>";
  html += "</head><body>";
  html += "<h1>ESP32 Wi-Fi Portal</h1>";
  html += "<p>Connect to <strong>" + String(AP_SSID) + "</strong> with password <strong>" + String(AP_PASSWORD) + "</strong>.</p>";
  html += "<p>AP IP: <code>" + WiFi.softAPIP().toString() + "</code></p>";
  html += "<p>STA IP: <code>" + (WiFi.status() == WL_CONNECTED ? WiFi.localIP().toString() : "not connected") + "</code></p>";
  html += "<p><strong>Status:</strong> " + getCurrentWiFiStatus() + "</p>";
  html += "<div class='card'><form method='POST' action='/save'>";
  html += "<label for='ssid'>Choose a network</label><select id='ssid' name='ssid'>" + wifiList + "</select>";
  html += "<label for='password'>Password</label><input id='password' name='password' type='password' placeholder='Optional for open networks'>";
  html += "<button type='submit'>Connect</button>";
  html += "</form></div>";
  html += "<div class='card'><p>You can also type a network name manually.</p><form method='POST' action='/save'>";
  html += "<label for='manual_ssid'>Wi-Fi name</label><input id='manual_ssid' name='ssid' type='text' placeholder='Manual SSID'>";
  html += "<label for='manual_password'>Password</label><input id='manual_password' name='password' type='password' placeholder='Manual password'>";
  html += "<button type='submit'>Connect manually</button>";
  html += "</form></div>";
  html += "</body></html>";
  
  Serial.println(">>> BUILD PORTAL PAGE COMPLETE");
  return html;
}

void handleRoot() {
  Serial.println(">>> HANDLE ROOT CALLED");
  server.send(200, "text/html", buildPortalPage());
  Serial.println(">>> HANDLE ROOT RESPONSE SENT");
}

void handleSave() {
  String ssid = server.arg("ssid");
  String pass = server.arg("password");

  if (ssid.length() == 0) {
    statusMessage = "Please enter a Wi-Fi name.";
    server.send(200, "text/html", buildPortalPage());
    return;
  }

  saveCredentials(ssid, pass);
  startConnection(ssid, pass);
  server.send(200, "text/html", buildPortalPage());
}

void handleNotFound() {
  server.send(404, "text/plain", "Not found");
}

void setup() {
  Serial.begin(115200);
  delay(1000);
  Serial.println("\n\n=== SETUP START ===");
  
  Serial2.begin(9600, SERIAL_8N1, ESP32_RX_PIN, ESP32_TX_PIN);
  Serial2.setTimeout(100); // 100 ms max wait — never block the loop
  Serial.println("Serial2 initialized");
  
  pinMode(AP_LED_PIN, OUTPUT);
  digitalWrite(AP_LED_PIN, LOW);
  Serial.println("LED initialized");

  // Start in AP+STA mode so hotspot stays on even when connected to Wi-Fi
  Serial.println("Setting WiFi mode to AP_STA...");
  WiFi.mode(WIFI_AP_STA);
  Serial.println("WiFi mode set");
  
  Serial.println("Loading credentials...");
  loadCredentials();
  Serial.println("Credentials loaded");

  Serial.println("Starting softAP...");
  bool apStarted = WiFi.softAP(AP_SSID, AP_PASSWORD);
  if (!apStarted) {
    Serial.println("Failed to start hotspot");
    dualPrintln("Failed to start hotspot");
  } else {
    Serial.println("Hotspot running");
    Serial.print("AP IP: ");
    Serial.println(WiFi.softAPIP().toString());
    dualPrintln("Hotspot running");
    dualPrint("AP IP: ");
    dualPrintln(WiFi.softAPIP().toString());
  }

  Serial.println("Starting DNS server...");
  dnsServer.start(53, "*", WiFi.softAPIP());
  Serial.println("DNS server started");

  Serial.println("Setting up web server routes...");
  server.on("/", handleRoot);
  server.on("/save", HTTP_POST, handleSave);
  server.onNotFound(handleNotFound);
  Serial.println("Routes configured");
  
  Serial.println("Starting web server...");
  server.begin();
  Serial.println("Web server started");

  if (savedSSID.length() > 0) {
    Serial.println("Attempting saved WiFi connection...");
    startConnection(savedSSID, savedPassword);
  } else {
    statusMessage = "No saved Wi-Fi. Use the portal to choose a network.";
    Serial.println("No saved WiFi credentials");
  }

  Serial.println("=== SETUP COMPLETE ===");
  dualPrintln("Open the portal at 192.168.4.1 and choose a Wi-Fi network.");
}

void loop() {
  dnsServer.processNextRequest();
  server.handleClient();

  static unsigned long lastPrint = 0;
  if (millis() - lastPrint > 5000) {
    Serial.println("LOOP RUNNING - waiting for requests...");
    lastPrint = millis();
  }

  // Periodically send current hour to UNO so it can control the relay
  static unsigned long lastTimeSend = 0;
  if (millis() - lastTimeSend >= 60000) { // every 60 seconds
    lastTimeSend = millis();
    struct tm timeinfo;
    if (getLocalTime(&timeinfo)) {
      String timeMsg = "TIME:" + String(timeinfo.tm_hour);
      Serial2.println(timeMsg);
      Serial.print("Sent time to UNO: ");
      Serial.println(timeMsg);
    } else {
      Serial.println("NTP time not available yet");
    }
  }

  if (isConnecting) {
      if (WiFi.status() == WL_CONNECTED) {
      isConnecting = false;
      statusMessage = "Connected to " + WiFi.SSID() + " (" + WiFi.localIP().toString() + ")";
      // Sync NTP time now that we have internet
      configTime(GMT_OFFSET_SEC, DAYLIGHT_OFFSET_SEC, NTP_SERVER);
      dualPrintln("NTP time sync started...");
      dualPrintln(statusMessage);
    } else if (millis() - connectStartMs >= CONNECT_TIMEOUT_MS) {
      isConnecting = false;
      int status = WiFi.status();
      int rssi = WiFi.RSSI();
      statusMessage = "Failed to connect to " + lastConnectSSID + ". Check password or signal.";
      dualPrintln(statusMessage);
      dualPrint("WiFi.status() = ");
      dualPrintln(String(status));
      dualPrint("RSSI = ");
      dualPrintln(String(rssi));
    }
  }

  while (Serial.available() > 0) {
    char c = Serial.read();
    if (c == '\r') {
      continue;
    }
    if (c == '\n') {
      if (inputBuffer.length() > 0) {
        dualPrint("Sending to Firebase (USB): ");
        dualPrintln(inputBuffer);
        bool ok = writeToFirebase(inputBuffer);
        if (ok) {
          dualPrintln("Saved to Firebase successfully.");
        } else {
          dualPrintln("Error saving to Firebase.");
        }
        inputBuffer = "";
      }
    } else {
      inputBuffer += c;
    }
  }

  if (Serial2.available() > 0) {
    String serialLine = Serial2.readStringUntil('\n');
    serialLine.trim();
    if (serialLine.length() > 0) {
      if (serialLine.startsWith("BATTERY:")) {
        // Format: BATTERY:<voltage>:<percent>
        String data = serialLine.substring(8); // strip "BATTERY:"
        int sep = data.indexOf(':');
        String voltage = (sep >= 0) ? data.substring(0, sep) : data;
        String percent = (sep >= 0) ? data.substring(sep + 1) : "0";
        Serial.print("Battery update: ");
        Serial.print(voltage);
        Serial.print("V  ");
        Serial.print(percent);
        Serial.println("%");
        writeBatteryToFirebase(voltage, percent);
      } else {
        dualPrint("Received from UNO: ");
        dualPrintln(serialLine);
        if (serialLine == "1") {
          dualPrint("Sending to Firebase (UNO): ");
          dualPrintln(serialLine);
          bool ok = writeToFirebase(serialLine);
          if (ok) {
            dualPrintln("Saved to Firebase successfully.");
          } else {
            dualPrintln("Error saving to Firebase.");
          }
        } else {
          Serial.print("Ignored UNO input (not a step): ");
          Serial.println(serialLine);
        }
      }
    }
  }

  // Monitor light control settings and send to UNO
  static unsigned long lastLightCheckTime = 0;
  if (millis() - lastLightCheckTime >= 5000) { // Check every 5 seconds
    lastLightCheckTime = millis();
    if (WiFi.status() == WL_CONNECTED) {
      // Read light control settings from Firebase
      HTTPClient https;
      client.setInsecure();
      https.setConnectTimeout(3000);
      https.setTimeout(3000);
      
      String url = String("https://") + FIREBASE_HOST + "/lightControl.json";
      https.begin(client, url);
      int httpCode = https.GET();
      
      if (httpCode == 200) {
        String payload = https.getString();
        Serial.print("Light control data: ");
        Serial.println(payload);
        // Send JSON to UNO prefixed with LIGHT: so UNO will parse it
        Serial2.print("LIGHT:");
        Serial2.println(payload);
      }
      https.end();
    }
  }
}
