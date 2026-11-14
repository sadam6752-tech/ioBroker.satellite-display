// The links of the tablets in the settings (tab Tablets): one per tablet, as text and as a QR code, so a tablet only
// has to look at the screen. The adapter answers `tabletLinks` with the links of the running web app.
import React from 'react';

import {
    Box,
    Button,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
    IconButton,
    Tooltip,
    Typography,
} from '@mui/material';
import { ContentCopy as IconCopy, QrCode2 as IconQr, Autorenew as IconRenew } from '@mui/icons-material';
import QRCode from 'react-qr-code';

import { I18n } from '@iobroker/gui-components';
import { ConfigGeneric, type ConfigGenericProps, type ConfigGenericState } from '@iobroker/json-config';

interface TabletLinksState extends ConfigGenericState {
    loading: boolean;
    links: { name: string; url: string }[] | null;
    error: string;
    /** The tablet whose new link waits for the confirmation */
    renew: string;
}

class TabletLinks extends ConfigGeneric<ConfigGenericProps, TabletLinksState> {
    constructor(props: ConfigGenericProps) {
        super(props);
        this.state = { ...this.state, loading: false, links: null, error: '', renew: '' };
    }

    /** A new link for the tablet: the adapter replaces its key, the old link stops working at once */
    async renewKey(name: string): Promise<void> {
        const { adapterName, instance, socket } = this.props.oContext;
        this.setState({ renew: '', loading: true });
        try {
            const answer = (await Promise.race([
                socket.sendTo(`${adapterName}.${instance}`, 'tabletNewKey', { tablet: name }),
                new Promise((_resolve, reject) => setTimeout(() => reject(new Error('timeout')), 8000)),
            ])) as { link?: { name: string; url: string }; error?: string } | undefined;
            if (answer?.link) {
                const link = answer.link;
                this.setState(s => ({
                    loading: false,
                    error: '',
                    links: (s.links || []).map(l => (l.name === link.name ? link : l)),
                }));
            } else {
                this.setState({ loading: false, error: I18n.t('sd_links_not_running') });
            }
        } catch {
            this.setState({ loading: false, error: I18n.t('sd_links_no_adapter') });
        }
    }

    renderRenewDialog(): React.JSX.Element | null {
        const name = this.state.renew;
        if (!name) {
            return null;
        }
        return (
            <Dialog
                open
                onClose={() => this.setState({ renew: '' })}
            >
                <DialogTitle>{I18n.t('sd_links_renew_title', name)}</DialogTitle>
                <DialogContent>
                    <Typography variant="body2">{I18n.t('sd_links_renew_text')}</Typography>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => this.setState({ renew: '' })}>{I18n.t('sd_cancel')}</Button>
                    <Button
                        color="warning"
                        variant="contained"
                        onClick={() => void this.renewKey(name)}
                    >
                        {I18n.t('sd_links_renew')}
                    </Button>
                </DialogActions>
            </Dialog>
        );
    }

    async load(): Promise<void> {
        const { adapterName, instance, socket } = this.props.oContext;
        this.setState({ loading: true, error: '' });
        try {
            const answer = (await Promise.race([
                socket.sendTo(`${adapterName}.${instance}`, 'tabletLinks', {}),
                new Promise((_resolve, reject) => setTimeout(() => reject(new Error('timeout')), 8000)),
            ])) as { links?: { name: string; url: string }[]; error?: string } | undefined;
            if (answer?.error || !Array.isArray(answer?.links)) {
                this.setState({ loading: false, links: null, error: I18n.t('sd_links_not_running') });
            } else {
                this.setState({ loading: false, links: answer.links, error: '' });
            }
        } catch {
            this.setState({ loading: false, links: null, error: I18n.t('sd_links_no_adapter') });
        }
    }

    renderItem(): React.JSX.Element {
        return (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, width: '100%' }}>
                <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap' }}>
                    <Button
                        variant="outlined"
                        startIcon={<IconQr />}
                        disabled={this.state.loading || !this.props.alive}
                        onClick={() => void this.load()}
                    >
                        {I18n.t('sd_links_show')}
                    </Button>
                    <Typography
                        variant="body2"
                        sx={{ opacity: 0.7, flex: '1 1 300px' }}
                    >
                        {this.props.alive ? I18n.t('sd_links_hint') : I18n.t('sd_links_no_adapter')}
                    </Typography>
                </Box>
                {this.state.error ? (
                    <Typography
                        variant="body2"
                        color="warning.main"
                    >
                        {this.state.error}
                    </Typography>
                ) : null}
                {this.state.links?.length === 0 ? (
                    <Typography variant="body2">{I18n.t('sd_links_none')}</Typography>
                ) : null}
                <Box sx={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
                    {(this.state.links || []).map(link => (
                        <Box
                            key={link.name}
                            sx={{
                                display: 'flex',
                                flexDirection: 'column',
                                gap: 1,
                                alignItems: 'center',
                                p: 2,
                                border: '1px solid',
                                borderColor: 'divider',
                                borderRadius: 1,
                                width: 260,
                            }}
                        >
                            <Typography variant="subtitle1">{link.name}</Typography>
                            {/* white around the code: a camera reads it also on the dark theme */}
                            <Box sx={{ background: '#fff', p: 2, lineHeight: 0 }}>
                                <QRCode
                                    value={link.url}
                                    size={196}
                                />
                            </Box>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, width: '100%' }}>
                                <Typography
                                    variant="caption"
                                    sx={{ wordBreak: 'break-all', userSelect: 'all', flex: 1 }}
                                >
                                    {link.url}
                                </Typography>
                                <Tooltip title={I18n.t('sd_links_copy')}>
                                    <IconButton
                                        size="small"
                                        onClick={() => void navigator.clipboard?.writeText(link.url)}
                                    >
                                        <IconCopy fontSize="small" />
                                    </IconButton>
                                </Tooltip>
                            </Box>
                            <Button
                                size="small"
                                color="warning"
                                startIcon={<IconRenew />}
                                disabled={this.state.loading}
                                onClick={() => this.setState({ renew: link.name })}
                            >
                                {I18n.t('sd_links_renew')}
                            </Button>
                        </Box>
                    ))}
                </Box>
                {this.renderRenewDialog()}
            </Box>
        );
    }
}

export default TabletLinks;
