import { Component } from "react";

export class ErrorBoundary extends Component {
  state = { error: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error("Wardrobe UI error:", error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="error-boundary" role="alert">
          <p>Something went wrong.</p>
          <button type="button" onClick={() => this.setState({ error: null })}>Try again</button>
        </div>
      );
    }
    return this.props.children;
  }
}
