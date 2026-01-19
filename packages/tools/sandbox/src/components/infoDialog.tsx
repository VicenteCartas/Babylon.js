import * as React from "react";

import "../scss/infoDialog.scss";

interface IInfoDialogProps {
    title: string;
    message: string;
    imageUrl?: string;
    onClose: () => void;
}

/**
 * Info dialog component that displays a title, message, and optional image
 */
export class InfoDialog extends React.Component<IInfoDialogProps> {
    public override render() {
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
                        <button className="info-dialog-button" onClick={() => this.props.onClose()}>
                            Got it
                        </button>
                    </div>
                </div>
            </div>
        );
    }
}
