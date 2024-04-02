import React, { useState } from 'react';
import { FlatList, StyleSheet, TextInputProps, View, Text } from 'react-native';

import { FormTextInput } from '../../../containers/TextInput';
import * as List from '../../../containers/List';
import { themes } from '../../../lib/constants';
import I18n from '../../../i18n';
import { TServerHistoryModel } from '../../../definitions';
import Item from './Item';
import { TSupportedThemes } from '../../../theme';

const styles = StyleSheet.create({
    container: {
        zIndex: 1
    },
    inputContainer: {
        marginTop: 0,
        marginBottom: 0,
        flexDirection: 'row',
        alignItems: 'center'
    },
    prefixText: {
		marginTop: 25,
        marginRight: 10,
        fontSize: 16,
        fontWeight: 'bold'
    },
    suffixText: {
		marginTop: 25,
        marginLeft: 10,
        fontSize: 16,
        fontWeight: 'bold'
    },
    serverHistory: {
        maxHeight: 180,
        width: '100%',
        top: '100%',
        zIndex: 1,
        position: 'absolute',
        borderWidth: StyleSheet.hairlineWidth,
        borderRadius: 4,
        borderTopWidth: 0
    }
});

interface IServerInput extends TextInputProps {
    text: string;
    theme: TSupportedThemes;
    serversHistory: any[];
    onSubmit(): void;
    onDelete(item: TServerHistoryModel): void;
    onPressServerHistory(serverHistory: TServerHistoryModel): void;
}

const ServerInput = ({
    text,
    theme,
    serversHistory,
    onChangeText,
    onSubmit,
    onDelete,
    onPressServerHistory
}: IServerInput): JSX.Element => {
    const [focused, setFocused] = useState(false);

    const handleTextChange = (newText: string) => {
        // Adiciona o prefixo e o sufixo ao texto
        const formattedText = `https://${newText}.vtcall.chat`;
        if(onChangeText) {
			onChangeText(formattedText);
	    }
	};

    return (
        <View style={styles.container}>
            <View style={styles.inputContainer}>
                <Text style={styles.prefixText}>https://</Text>
                <FormTextInput
                    label={I18n.t('Enter_workspace_URL')}
                    placeholder={I18n.t('Workspace_URL_Example')}
                    containerStyle={{ flex: 1, marginTop: 0, marginBottom: 0 }}
                    value={text.replace('https://', '').replace('.vtcall.chat', '')} // Remove prefixo e sufixo para mostrar apenas o valor do meio
                    returnKeyType='send'
                    onChangeText={handleTextChange} // Usa a função modificada
                    onSubmitEditing={onSubmit}
                    clearButtonMode='while-editing'
                    keyboardType='url'
                    textContentType='URL'
                    onFocus={() => setFocused(true)}
                    onBlur={() => setFocused(false)}
                />
                <Text style={styles.suffixText}>.vtcall.chat</Text>
            </View>
            {focused && serversHistory?.length ? (
                <View
                    style={[
                        styles.serverHistory,
                        { backgroundColor: themes[theme].backgroundColor, borderColor: themes[theme].separatorColor }
                    ]}
                >
                    <FlatList
                        data={serversHistory}
                        renderItem={({ item }) => (
                            <Item item={item} theme={theme} onPress={() => onPressServerHistory(item)} onDelete={onDelete} />
                        )}
                        ItemSeparatorComponent={List.Separator}
                        keyExtractor={item => item.id}
                    />
                </View>
            ) : null}
        </View>
    );
};

export default ServerInput;
