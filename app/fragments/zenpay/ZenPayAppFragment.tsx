import * as React from 'react';
import { fragment } from '../../fragment';
import { Platform, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useEngine } from '../../engine/Engine';
import { ZenPayAppComponent } from './ZenPayAppComponent';
import { Theme } from '../../Theme';
import { useParams } from '../../utils/useParams';
import { t } from '../../i18n/t';
import { ZenPayEnrolmentComponent } from './ZenPayEnrolmentComponent';
import { useMemo } from 'react';
import { extractDomain } from '../../engine/utils/extractDomain';

export type ZenPayAppParams = { type: 'card'; id: string; } | { type: 'account' };

export const ZenPayAppFragment = fragment(() => {
    const engine = useEngine();
    const params = useParams<ZenPayAppParams>();
    const safeArea = useSafeAreaInsets();
    const status = engine.products.zenPay.useStatus();
    const endpoint = useMemo(() => {
        return 'https://next.zenpay.org' + (params.type === 'account' ? '' : '/cards/' + params.id)
    }, [params]);
    const domain = extractDomain(endpoint);
    const needsEnrolment = useMemo(() => {
        try {
            const key = engine.products.keys.getDomainKey(domain);
            if (status.state === 'need-enrolment') {
                return true;
            }
        } catch (error) {
            return true;
        }
        return false;
    }, [status, domain]);

    return (
        <View style={{
            flex: 1,
            paddingTop: Platform.OS === 'android' ? safeArea.top : undefined,
            backgroundColor: Theme.background
        }}>
            <StatusBar style={Platform.OS === 'ios' ? 'light' : 'dark'} />

            {!needsEnrolment && (
                <ZenPayAppComponent
                    title={t('products.zenPay.title')}
                    variant={params}
                    token={(
                        status as { state: 'need-phone', token: string }
                        | { state: 'need-kyc', token: string }
                        | { state: 'ready', token: string }
                    ).token}
                    endpoint={endpoint}
                />
            )}

            {needsEnrolment && (
                <ZenPayEnrolmentComponent engine={engine} endpoint={endpoint} />
            )}
        </View>
    );
});