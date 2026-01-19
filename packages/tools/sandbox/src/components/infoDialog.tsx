import * as React from "react";

import "../scss/infoDialog.scss";

interface IInfoDialogProps {
    title: string;
    message: string;
    imageUrl?: string;
    onClose: () => void;
    showInstallButton?: boolean;
}

interface IInfoDialogState {
    canInstall: boolean;
}

// Store the install prompt event globally so it persists
let DeferredInstallPrompt: IBeforeInstallPromptEvent | null = null;

interface IBeforeInstallPromptEvent extends Event {
    prompt: () => Promise<void>;
    userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

// Capture the beforeinstallprompt event
if (typeof window !== "undefined") {
    window.addEventListener("beforeinstallprompt", (e) => {
        e.preventDefault();
        DeferredInstallPrompt = e as IBeforeInstallPromptEvent;
    });
}

/**
 * Info dialog component that displays a title, message, and optional image
 */
export class InfoDialog extends React.Component<IInfoDialogProps, IInfoDialogState> {
    constructor(props: IInfoDialogProps) {
        super(props);
        this.state = {
            canInstall: DeferredInstallPrompt !== null,
        };
    }

    override componentDidMount() {
        // Listen for the beforeinstallprompt event in case it fires after component mounts
        window.addEventListener("beforeinstallprompt", this._handleBeforeInstallPrompt);
    }

    override componentWillUnmount() {
        window.removeEventListener("beforeinstallprompt", this._handleBeforeInstallPrompt);
    }

    private _handleBeforeInstallPrompt = (e: Event) => {
        e.preventDefault();
        DeferredInstallPrompt = e as IBeforeInstallPromptEvent;
        this.setState({ canInstall: true });
    };

    private _handleInstallAsync = async () => {
        if (!DeferredInstallPrompt) {
            return;
        }

        await DeferredInstallPrompt.prompt();
        const choiceResult = await DeferredInstallPrompt.userChoice;

        if (choiceResult.outcome === "accepted") {
            DeferredInstallPrompt = null;
            this.setState({ canInstall: false });
        }

        this.props.onClose();
    };

    public override render() {
        const showInstall = this.props.showInstallButton && this.state.canInstall;

        return (
            <div className="info-dialog-overlay" onClick={() => this.props.onClose()}>
                <div className="info-dialog" onClick={(e) => e.stopPropagation()}>
                    <div className="info-dialog-header">
                        <h2 className="info-dialog-title">{this.props.title}</h2>
                        <button className="info-dialog-close" onClick={() => this.props.onClose()}>
                            &times;
                        </button>
                    </div>
                    <div className="info-dialog-content">
                        <p className="info-dialog-message">{this.props.message}</p>
                        {this.props.imageUrl && <img className="info-dialog-image" src={this.props.imageUrl} alt="" />}
                    </div>
                    <div className="info-dialog-footer">
                        {showInstall && (
                            <button className="info-dialog-button info-dialog-button-primary" onClick={this._handleInstallAsync}>
                                Install App
                            </button>
                        )}
                        <button className="info-dialog-button info-dialog-button-secondary" onClick={() => this.props.onClose()}>
                            {showInstall ? "Not now" : "Got it"}
                        </button>
                    </div>
                </div>
            </div>
        );
    }
}
