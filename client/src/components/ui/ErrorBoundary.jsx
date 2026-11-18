import { Component } from "react";

export default class ErrorBoundary extends Component {
  state = { error: null };
  static getDerivedStateFromError(error) {
    return { error };
  }
  componentDidCatch(error, info) {
    console.error("[ui]", error, info);
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="grid min-h-screen place-items-center p-6 text-center">
        <div>
          <h1 className="text-3xl">This screen hit a pothole</h1>
          <p className="mt-2 muted">Reload the page to continue. Your trip data is safe on the server.</p>
          <button className="btn-primary mt-6" onClick={() => window.location.reload()}>
            Reload NavNet
          </button>
        </div>
      </div>
    );
  }
}
