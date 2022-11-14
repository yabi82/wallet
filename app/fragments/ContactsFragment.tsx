import { StatusBar } from "expo-status-bar";
import React, { useMemo } from "react";
import { Platform, View, Text, ScrollView } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AndroidToolbar } from "../components/AndroidToolbar";
import { CloseButton } from "../components/CloseButton";
import { ContactItemView } from "../components/Contacts/ContactItemView";
import { useEngine } from "../engine/Engine";
import { fragment } from "../fragment";
import { t } from "../i18n/t";
import { Theme } from "../Theme";
import { formatDate, getDateKey } from "../utils/dates";
import { useTypedNavigation } from "../utils/useTypedNavigation";
import { TransactionView } from "./wallet/views/TransactionView";

export const ContactsFragment = fragment(() => {
    const navigation = useTypedNavigation();
    const engine = useEngine();
    const account = engine.products.main.useAccount();
    const transactions = account?.transactions ?? [];
    const safeArea = useSafeAreaInsets();
    const settings = engine.products.settings;
    const contacts = settings.useContacts();

    const contactsList = useMemo(() => {
        return Object.entries(contacts);
    }, [contacts]);

    const transactionsSectioned = React.useMemo(() => {
        let sections: { title: string, items: string[] }[] = [];
        if (transactions.length > 0) {
            let lastTime: string = getDateKey(transactions[0].time);
            let lastSection: string[] = [];
            let title = formatDate(transactions[0].time);
            sections.push({ title, items: lastSection });
            for (let t of transactions.length >= 3 ? transactions.slice(0, 3) : transactions) {
                let time = getDateKey(t.time);
                if (lastTime !== time) {
                    lastSection = [];
                    lastTime = time;
                    title = formatDate(t.time);
                    sections.push({ title, items: lastSection });
                }
                lastSection.push(t.id);
            }
        }
        return sections;
    }, [transactions]);

    const transactionsComponents: any[] = [];
    for (let s of transactionsSectioned) {
        transactionsComponents.push(
            <View key={'t-' + s.title} style={{ marginTop: 8, backgroundColor: Theme.background }} collapsable={false}>
                <Text style={{ fontSize: 18, fontWeight: '700', marginHorizontal: 16, marginVertical: 8 }}>{s.title}</Text>
            </View>
        );
        transactionsComponents.push(
            <View
                key={'s-' + s.title}
                style={{ marginHorizontal: 16, borderRadius: 14, backgroundColor: 'white', overflow: 'hidden' }}
                collapsable={false}
            >
                {s.items.map((t, i) => <TransactionView
                    own={engine.address}
                    engine={engine} 
                    tx={t}
                    separator={i < s.items.length - 1}
                    key={'tx-' + t}
                    onPress={() => { }}
                />)}
            </View >
        );
    }

    return (
        <View style={{
            flex: 1,
            paddingTop: Platform.OS === 'android' ? safeArea.top : undefined,
        }}>
            <StatusBar style={Platform.OS === 'ios' ? 'light' : 'dark'} />
            <AndroidToolbar pageTitle={t('contacts.title')} />
            {Platform.OS === 'ios' && (
                <View style={{
                    marginTop: 12,
                    height: 32
                }}>
                    <Text style={[{
                        fontWeight: '600',
                        marginLeft: 17,
                        fontSize: 17
                    }, { textAlign: 'center' }]}>
                        {t('contacts.title')}
                    </Text>
                </View>
            )}
            <ScrollView>
                <View style={{
                    marginBottom: 16, marginTop: 17,
                    borderRadius: 14,
                    paddingHorizontal: 16,
                    flexShrink: 1,
                }}>
                    {contactsList.map((d) => {
                        return (
                            <ContactItemView
                                key={`contact-${d[0]}`}
                                addr={d[0]}
                                contact={d[1]}
                            />
                        );
                    })}
                </View>
                {(!contactsList || contactsList.length === 0) && (
                    <>
                        {(!contactsList || contactsList.length === 0) && (
                            <View style={{ backgroundColor: Theme.background }} collapsable={false}>
                                <Text style={{
                                    fontSize: 18,
                                    fontWeight: '700',
                                    marginHorizontal: 16,
                                    marginVertical: 8,
                                    color: Theme.textSecondary
                                }}>
                                    {t('contacts.empty')}
                                </Text>
                                <Text style={{
                                    fontSize: 16,
                                    fontWeight: '700',
                                    marginHorizontal: 16,
                                    marginVertical: 8,
                                    color: Theme.textColor
                                }}>
                                    {t('contacts.description')}
                                </Text>
                            </View>
                        )}
                        {transactionsComponents}
                    </>
                )}
            </ScrollView>
            {Platform.OS === 'ios' && (
                <CloseButton
                    style={{ position: 'absolute', top: 12, right: 10 }}
                    onPress={() => {
                        navigation.goBack();
                    }}
                />
            )}
        </View>
    )
});