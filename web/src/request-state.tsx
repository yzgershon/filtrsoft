import { Component, type ReactNode } from "react";
import { Again } from "./icons.tsx";

export function RequestError({ message, retry }: { message: string; retry: () => void }) {
  return <div className="request-error" role="alert"><p>{message}</p><button className="btn2" onClick={retry}><Again size={15} /> Try again</button></div>;
}

/** One malformed screen must not remove navigation and the rest of the app. */
export class ScreenBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    return this.state.failed ? <RequestError message="This screen couldn't be displayed." retry={() => this.setState({ failed: false })} /> : this.props.children;
  }
}
