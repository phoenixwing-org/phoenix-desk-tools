/**
 * @copyright   Shanghai Kuntai Software Technology Co., Ltd. 2025
 * @license     MIT
 * @author      Phoenix Wing
 * @file
 * @version		V1.0
 * @brief
 * @details
 * @date		2025-12-17
 */

#ifndef KTCAutoDialog_H
#define KTCAutoDialog_H

// Dialog Framework
#include "CATDialogAgent.h"
#include "CATDlgDialog.h"
#include "CATDlgInclude.h"
#include "CATISpecObject.h"
#include "CATString.h"

// auto code
#include "KTCAutoCode.h"
#include "KTCAutoCodeUI.h"
#include "KTCAutoHSO.h"
#include "KTCAutoSelectorCtx.h"
#include "KTCAutoValueChangedNtf.h"

/** @brief KTCAutoDialog Dialog */
class ExportedByKTCAutoCodeUI KTCAutoDialog : public CATDlgDialog {
    DeclareResource(KTCAutoDialog, CATDlgDialog);

public:
    KTCAutoDialog(CATDialog* iParent, CATMMUIPanelStateCmd* iFatherCmd,
                  const CATString& iObjectName, CATDlgStyle iStyle = NULL);
    virtual ~KTCAutoDialog();

public:
    /** @brief nodoc
     *  returned sub command, 0 for no Sub Command
     */
    int ActionSubCommandReturn();

    /**
     * @brief checkout title
     * @param object input object
     * @return title string for dialog, if null ,return ""
     */
    static CATUnicodeString checkout_title(CATISpecObject_var object);

    /** @brief Get Active Field */
    inline int GetActiveField() const {
        return activeField_;
    };

    /** @brief Get Active Field */
    inline KTC::ValueActionMode GetValueMode() const {
        return actionMode_;
    };

    /**
     * @brief nodoc
     */
    int InitialMenuRightClick();

    /** @brief Callback on show option dialog */
    virtual void on_show_option_dialog(CATCommand*, CATNotification*, CATCommandClientData);

    /** @brief Register Parameter Dialog */
    void register_option_dialog(CATDlgDialog* dlg);

    /** @brief Register Parameter Dialog */
    void register_option_dialog(CATDlgDialog* dlg, CATDlgPushButton* optionBtn);

    /**
     * @brief register field
     * @param field field id
     * @param selector CATDlgSelectorList pointer
     * @param name selector name
     * @return KTCAutoSelectorCtx pointer
     */
    KTCAutoSelectorCtx* regitster_field(int field, CATDlgSelectorList* selector,
                                        const KtString& name = "");

    /** @brief nodoc */
    static int selectorlist_setline(CATDlgSelectorList*     selectorList,
                                    CATISpecObject_var      inputObject,
                                    const CATUnicodeString& noneSel = "(No Selection)");

    /** @brief nodoc */
    static int selectorlist_setline(CATDlgSelectorList*                 selectorList,
                                    const CATListValCATISpecObject_var& iList,
                                    const CATUnicodeString&             noneSel = "(No Selection)");

    /** @brief send value change notification */
    void SendValueCHangeNotification();

    /**
     * @brief Set Accept On Notify Of Value Change
     * @param[in] ipDialogAgent Value Change Agent
     */
    virtual void SetAcceptOnNotifyOfValueChange(CATDialogAgent* ipDialogAgent) = 0;

    /** @brief Set Active Field */
    void SetActiveField(int feild);

    /** @brief Set Active Field Focus */
    void SetActiveFieldFocus();

    /**
     * @brief Show Message Box
     * @param[in] msg message
     * @param[in] dialog Parrent dialo
     */
    static void ShowMessageBox(const CATUnicodeString& msg, CATDialog* dialog = NULL);

    /**
     * @brief Show Message Box
     * @param[in] code Error Code
     * @param[in] msg message
     * @param[in] dialog Parrent dialo
     * @note DONOT show message if code == 0 and msg is empty
     */
    static void ShowMessageBox(int code, const CATUnicodeString& msg, CATDialog* dialog = NULL);

    /**
     * @brief Show Message Box
     * @param[in] code Error Code
     * @param[in] msg Kt String, Local charset
     * @param[in] dialog Parrent dialo
     * @note DONOT show message if code == 0 and msg is empty
     */
    static void ShowMessageBox(int code, const KtString& msg, CATDialog* dialog = NULL);

    /**
     * @brief Show Message Box
     * @param[in] code Error Code
     * @param[in] msg  const char*, Local charset
     * @param[in] dialog Parrent dialo
     * @note DONOT show message if code == 0 and msg is empty
     */
    static void ShowMessageBox(int code, const char* msg, CATDialog* dialog = NULL);

    /** @brief Set Params to Dialog */
    virtual void UpdateDialog() = 0;

    /** @brief Update Params From Dialog */
    virtual void UpdateInfos() = 0;

    /** @brief Update dialog Sensitivity */
    virtual void UpdateSensitivity() = 0;

protected:
public:
    CATDlgDialog* optionDialog_; // sub dialog
    CATHSO*       catHSO_;       // catia HSO

private:
    int                     activeField_;    // current field
    KTC::ValueActionMode    actionMode_;     // action mode
    KTCAutoSelectorCtxMap*  selectorMap_;    // selector map
    KTCAutoValueChangedNtf* valueChangeNtf_; // value change notification
};

#endif
