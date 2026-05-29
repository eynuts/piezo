// =====================================================
// PIEZO ENERGY DASHBOARD - ARDUINO UNO
// Monitors piezo footstep sensor, battery voltage, and light relay
// =====================================================

#include <SoftwareSerial.h>
#include <Wire.h>
#include <LiquidCrystal_I2C.h>

// UNO pins for ESP32 serial link
const int UNO_ESP_RX_PIN = 2; // UNO receives from ESP32 TX
const int UNO_ESP_TX_PIN = 3; // UNO sends to ESP32 RX
SoftwareSerial espSerial(UNO_ESP_RX_PIN, UNO_ESP_TX_PIN);

// LCD
LiquidCrystal_I2C lcd(0x27, 16, 2);

// Relay pins
const int RELAY_IN1 = 6; // controlled by time or manual mode (6 PM to 5 AM / manual)
// Your hardware uses active-HIGH (writing HIGH turns the relay ON). Set to false.
const bool LIGHT_RELAY_ACTIVE_LOW = false; // was true, flipped to match wiring

// 3S 18650 pack voltage range
const float BATTERY_MAX_V = 12.6; // 3 x 4.2V = 100%
const float BATTERY_MIN_V = 9.0;  // 3 x 3.0V = 0%

int calcBatteryPercent(float v) {
  if (v >= BATTERY_MAX_V) return 100;
  if (v <= BATTERY_MIN_V) return 0;
  return (int)(((v - BATTERY_MIN_V) / (BATTERY_MAX_V - BATTERY_MIN_V)) * 100.0);
}

long readVcc() {
  // Read the internal 1.1V reference against Vcc. This makes the battery voltage
  // measurement independent of whether the UNO is powered by USB or battery.
  ADMUX = _BV(REFS0) | _BV(MUX3) | _BV(MUX2) | _BV(MUX1);
  delay(2); // let Vref settle
  ADCSRA |= _BV(ADSC);
  while (bit_is_set(ADCSRA, ADSC));
  int result = ADCL;
  result |= ADCH << 8;
  return (1100L * 1023L) / result;
}

void setLightRelay(bool on) {
  int pinState = on ? (LIGHT_RELAY_ACTIVE_LOW ? LOW : HIGH) : (LIGHT_RELAY_ACTIVE_LOW ? HIGH : LOW);
  digitalWrite(RELAY_IN1, pinState);
}

const int SENSOR_PIN   = A0;
const int BATTERY_PIN  = A1;

// Most voltage sensor modules already include a voltage divider.
// Set this to the module's division ratio, for example 5.0 for a 1/5 divider when measuring up to 25V.
const float BATTERY_DIVIDER_RATIO = 5.0;
const float BATTERY_V_OFFSET = 0.9; // extra voltage added to the displayed battery voltage

// Piezo step detection
// No voltage divider — sensor connects directly to A0.
// Use raw ADC counts from 0..1023.
const int STEP_THRESHOLD  = 30;   // ADC count threshold for step detection
const int STEP_RESET_HYST = 41;   // ADC count for ~0.2V on A0
bool wasAboveThreshold = false;

// Battery rolling average
const int   BATTERY_SAMPLES = 10;
float       batteryReadings[BATTERY_SAMPLES];
int         batteryIndex     = 0;
bool        batteryBufferFull = false;

// Send BATTERY update every 5 seconds — not every loop
const unsigned long BATTERY_SEND_INTERVAL = 5000;
unsigned long lastBatterySend = 0;

// Time from ESP32
int currentHour = -1;
String espBuffer = "";
String inputBuffer = "";

// Light control settings
String lightControlMode = "auto"; // "auto" or "manual"
bool lightControlState = false;   // true = on, false = off

// LCD light status notification
String lightStatusText = "";
unsigned long lightStatusTimestamp = 0;
const unsigned long LIGHT_STATUS_DISPLAY_MS = 5000;

bool isRelayOnTime(int hour) {
  if (hour < 0) return false;
  return (hour >= 18 || hour < 6); // 6 PM (18) to 6 AM (6)
}

void updateRelayPhysicalState() {
  int pinState = digitalRead(RELAY_IN1);
  bool lampOn = (pinState == (LIGHT_RELAY_ACTIVE_LOW ? LOW : HIGH));
  Serial.print("Relay pin state: ");
  Serial.print(pinState == HIGH ? "HIGH" : "LOW");
  Serial.print("  -> Lamp ");
  Serial.println(lampOn ? "ON" : "OFF");

  // Update LCD status text (preserve existing lightStatusText format)
  String base = "Light:";
  base += (lightControlMode == "manual") ? "MAN" : "AUTO";
  base += (lightControlMode == "manual") ? (lightControlState ? " ON" : " OFF") : (isRelayOnTime(currentHour) ? " ON" : " OFF");
  base += lampOn ? " PHYS:ON" : " PHYS:OFF";
  lightStatusText = base;
  lightStatusTimestamp = millis();
}

void setup() {
  Serial.begin(9600);
  espSerial.begin(9600);

  pinMode(RELAY_IN1, OUTPUT);
  setLightRelay(false); // OFF
  updateRelayPhysicalState();

  for (int i = 0; i < BATTERY_SAMPLES; i++) batteryReadings[i] = 0.0;

  lcd.init();
  lcd.backlight();
  lcd.setCursor(0, 0);
  lcd.print("Piezo Monitor");
  delay(2000);
  lcd.clear();

  Serial.println("UNO ready.");
}

void loop() {
  // ── Piezo step detection ──────────────────────────────────────────────────
  int   sensorRaw  = analogRead(SENSOR_PIN); // direct piezo sensor on A0, raw ADC counts
  bool aboveThreshold = (sensorRaw >= STEP_THRESHOLD);

  if (aboveThreshold && !wasAboveThreshold) {
    // Rising edge — send step immediately before anything else
    espSerial.println("1");
    Serial.print("Step detected! ADC=");
    Serial.println(sensorRaw);
    wasAboveThreshold = true;
  } else if (!aboveThreshold && sensorRaw < STEP_RESET_HYST) {
    // Only reset once voltage drops below hysteresis level
    wasAboveThreshold = false;
  }

  // ── Battery reading (rolling average) ────────────────────────────────────
  // If your voltage sensor module has a divider, recover the real battery voltage.
  int   battRaw  = analogRead(BATTERY_PIN);
  float vccV = readVcc() / 1000.0;
  float battVolt = battRaw * (vccV / 1023.0) * BATTERY_DIVIDER_RATIO;
  battVolt += BATTERY_V_OFFSET;

  batteryReadings[batteryIndex] = battVolt;
  batteryIndex = (batteryIndex + 1) % BATTERY_SAMPLES;
  if (batteryIndex == 0) batteryBufferFull = true;

  int   count   = batteryBufferFull ? BATTERY_SAMPLES : batteryIndex;
  float battSum = 0.0;
  for (int i = 0; i < count; i++) battSum += batteryReadings[i];
  float battAvg    = (count > 0) ? battSum / count : 0.0;
  int   battPercent = calcBatteryPercent(battAvg);

  // ── Control RELAY_IN1 based on light control mode ──────────────────────
  if (lightControlMode == "manual") {
    // Manual mode: use the state from Firebase
    setLightRelay(lightControlState);
    updateRelayPhysicalState();
  } else {
    // Automatic mode: use time-based logic (6 PM to 5 AM)
    setLightRelay(isRelayOnTime(currentHour));
    updateRelayPhysicalState();
  }

  // ── Send BATTERY to ESP32 every 5 seconds (not every loop) ───────────────
  unsigned long now = millis();
  if (now - lastBatterySend >= BATTERY_SEND_INTERVAL) {
    lastBatterySend = now;
    espSerial.print("BATTERY:");
    espSerial.print(battAvg, 2);
    espSerial.print(":");
    espSerial.println(battPercent);
    Serial.print("Battery sent: ");
    Serial.print(battAvg, 2);
    Serial.print("V  ");
    Serial.print(battPercent);
    Serial.print("%  Vcc=");
    Serial.print(vccV, 3);
    Serial.print("V raw=");
    Serial.print(battRaw);
    Serial.println();
  }

  // ── LCD ──────────────────────────────────────────────────────────────────
  if (millis() - lightStatusTimestamp < LIGHT_STATUS_DISPLAY_MS && lightStatusText.length() > 0) {
    lcd.setCursor(0, 0);
    lcd.print(lightStatusText);
    int pad = 16 - lightStatusText.length();
    while (pad-- > 0) lcd.print(' ');

    lcd.setCursor(0, 1);
    lcd.print("Bat:");
    lcd.print(battAvg, 1);
    lcd.print("V ");
    lcd.print(battPercent);
    lcd.print("%  ");
  } else {
    lcd.setCursor(0, 0);
    lcd.print("Piezo:");
    lcd.print(sensorRaw);
    lcd.print("   ");

    lcd.setCursor(0, 1);
    lcd.print("Bat:");
    lcd.print(battAvg, 1);
    lcd.print("V ");
    lcd.print(battPercent);
    lcd.print("%  ");
  }

  // ── Debug to Serial Monitor ───────────────────────────────────────────────
  Serial.print("Piezo ADC=");
  Serial.print(sensorRaw);
  Serial.print("  Bat=");
  Serial.print(battAvg, 2);
  Serial.print("V  ");
  Serial.print(battPercent);
  Serial.println("%");

  // ── Read from USB Serial Monitor ─────────────────────────────────────────
  while (Serial.available() > 0) {
    char c = Serial.read();
    if (c == '\r') continue;
    if (c == '\n') {
      if (inputBuffer.length() > 0) {
        espSerial.println(inputBuffer);
        Serial.print("Sent to ESP32: ");
        Serial.println(inputBuffer);
        inputBuffer = "";
      }
    } else {
      inputBuffer += c;
    }
  }

  // ── Read responses from ESP32 ─────────────────────────────────────────────
  while (espSerial.available() > 0) {
    char c = espSerial.read();
    if (c == '\n') {
      espBuffer.trim();
      if (espBuffer.startsWith("TIME:")) {
        currentHour = espBuffer.substring(5).toInt();
        Serial.print("Time from ESP32: hour=");
        Serial.println(currentHour);
      } else if (espBuffer.startsWith("LIGHT:")) {
        // Format: LIGHT:{"mode":"auto","state":false}
        // Parse light control settings
        String data = espBuffer.substring(6); // strip "LIGHT:"
        if (data.indexOf("\"mode\"") >= 0) {
          if (data.indexOf("\"manual\"") >= 0) {
            lightControlMode = "manual";
          } else if (data.indexOf("\"auto\"") >= 0) {
            lightControlMode = "auto";
          }
        }
        if (data.indexOf("\"state\"") >= 0) {
          lightControlState = (data.indexOf("\"state\":true") >= 0);
        }
        Serial.print("Light control updated: mode=");
        Serial.print(lightControlMode);
        Serial.print(" state=");
        Serial.println(lightControlState ? "ON" : "OFF");
        
        lightStatusText = "Light:";
        lightStatusText += (lightControlMode == "manual") ? "MAN" : "AUTO";
        lightStatusText += lightControlMode == "manual"
          ? (lightControlState ? " ON" : " OFF")
          : (isRelayOnTime(currentHour) ? " ON" : " OFF");
        lightStatusTimestamp = millis();
        // After processing the incoming LIGHT update, log/display physical relay state
        updateRelayPhysicalState();
      } else if (espBuffer.length() > 0) {
        Serial.println(espBuffer);
      }
      espBuffer = "";
    } else if (c != '\r') {
      espBuffer += c;
    }
  }

  delay(50); // short delay — fast enough to catch piezo pulses
}
