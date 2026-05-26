import React, { useState } from "react";
import Home from "./home/Home";
import Splash from "./home/Splash";

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) {
    return { error: error?.message || String(error) };
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{
          color: "#ff6b6b",
          background: "#0b1118",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: "24px",
          fontFamily: "monospace",
          fontSize: "14px",
          textAlign: "center",
          gap: "12px"
        }}>
          <div style={{ fontSize: "24px" }}>⚠️ Render Error</div>
          <div style={{ color: "#e6f6ff", wordBreak: "break-word" }}>{this.state.error}</div>
        </div>
      );
    }
    return this.props.children;
  }
}

function App() {
  const [phase, setPhase] = useState("splash");
  return (
    <ErrorBoundary>
      <div className="App" style={{ height: "100%", width: "100%" }}>
        {phase === "splash" ? <Splash onDone={() => setPhase("home")} /> : <Home />}
      </div>
    </ErrorBoundary>
  );
}

export default App;
