/**
 * @copyright   Copyright 2021 Kevin Time Toolkit
 * @license     MIT
 * @author      Phoenix Wing
 * @file
 * @version		V1.0
 * @brief
 * @details
 * @date		2025-12-17
 */

// cat
#include "CATApplicationFrame.h"
#include "CATDialogAgent.h"
#include "CATDlgNotify.h"
#include "CATDlgWindow.h"
#include "CATIAlias.h"
#include "CATLISTV_CATISpecObject.h"
#include "CATListOfCATUnicodeString.h"
#include "CATMMUIPanelStateCmd.h"
#include "iostream.h"

// Auto Code
#include "KTCAutoDialog.h"
#include "KTCAutoSelectorCtx.h"

//-------------------------------------------------------------------------
KTCAutoDialog::KTCAutoDialog(CATDialog* iParent, CATMMUIPanelStateCmd* iFatherCmd,
                             const CATString& iObjectName, CATDlgStyle iStyle)
    // CATDialog *iParent, CATCommand *iEventMgr, const CATString& iObjectName, CATDlgStyle
    // iStyle=NULL
    : CATDlgDialog(iParent, iFatherCmd, iObjectName, iStyle)
    , optionDialog_(NULL)
    , activeField_(0)
    , catHSO_(NULL)
    , actionMode_(KTC::ValueNormal)
    , selectorMap_(NULL)
    , valueChangeNtf_(NULL) {
    selectorMap_    = new std::map<int, KTCAutoSelectorCtx*>();
    valueChangeNtf_ = new KTCAutoValueChangedNtf();
}
//-------------------------------------------------------------------------
KTCAutoDialog::~KTCAutoDialog() {
    optionDialog_ = NULL;
    catHSO_       = NULL;
    // activeField_ = 0;

    if (selectorMap_) {
        KTCAutoSelectorCtx* ctx;
        for (size_t i = 0; i < selectorMap_->size(); i++) {
            ctx = (*selectorMap_)[ i ]; // get
            delete ctx;                 // delete
        }
        delete selectorMap_, selectorMap_ = NULL; // 手动释放
    }

    delete valueChangeNtf_, valueChangeNtf_ = NULL; // 手动释放
}
//-------------------------------------------------------------------------
int KTCAutoDialog::ActionSubCommandReturn() {
    // TODO 实现代码
    cout << " - 没有实现 " << __FUNCTION__ << endl;
    return 0;
}
//-----------------------------------------------------------------------------
CATUnicodeString KTCAutoDialog::checkout_title(CATISpecObject_var object) {
    if (!object) return ""; // 没有特征

    // 存在，检出名字
    CATIAlias_var alias = object;
    if (!!alias) // get alias
        return alias->GetAlias();
    else // or get display name
        return object->GetDisplayName();
}
//-------------------------------------------------------------------------
int KTCAutoDialog::InitialMenuRightClick() {
    // TODO 实现代码
    return 0;
}
//-------------------------------------------------------------------------
void KTCAutoDialog::on_show_option_dialog(CATCommand*, CATNotification*, CATCommandClientData) {
    if (!optionDialog_) return;

    // change state
    CATULong state = (optionDialog_->GetVisibility() == CATDlgShow) ? CATDlgHide : CATDlgShow;
    optionDialog_->SetVisibility(state);
}
//-------------------------------------------------------------------------
void KTCAutoDialog::register_option_dialog(CATDlgDialog* dlg) {
    optionDialog_ = dlg;
}
//-------------------------------------------------------------------------
void KTCAutoDialog::register_option_dialog(CATDlgDialog* dlg, CATDlgPushButton* optionBtn) {
    optionDialog_ = dlg;
    // option dialog
    if (!optionBtn) return;

    AddAnalyseNotificationCB(optionBtn, optionBtn->GetPushBActivateNotification(),
                             (CATCommandMethod)&KTCAutoDialog::on_show_option_dialog, NULL);

    // close
    AddAnalyseNotificationCB(optionDialog_, optionDialog_->GetDiaCLOSENotification(),
                             (CATCommandMethod)&KTCAutoDialog::on_show_option_dialog, NULL);
}
//-------------------------------------------------------------------------
KTCAutoSelectorCtx* KTCAutoDialog::regitster_field(int field, CATDlgSelectorList* selector,
                                                   const KtString& name) {
    if (!selector) return NULL;
    if (!selectorMap_) selectorMap_ = new KTCAutoSelectorCtxMap(); // 第一次注册时，创建map

    // C++98 需要显式指定迭代器类型
    KTCAutoSelectorCtxMap::iterator it = selectorMap_->find(field);
    if (it != selectorMap_->end()) {
        cout << "- [ERROR] Field " << field << " already registered!" << endl;
        return NULL; // 找到元素,已经注册过了
    }

    // 未找到元素，注册
    KTCAutoSelectorCtx* ctx = new KTCAutoSelectorCtx(field, selector);
    // ctx->selector        = selector;
    ctx->fieldName = name;

    (*selectorMap_)[ field ] = ctx;
    return ctx;
}
//-----------------------------------------------------------------------------
int KTCAutoDialog::selectorlist_setline(CATDlgSelectorList*     selectorList,
                                        CATISpecObject_var      inputObject,
                                        const CATUnicodeString& noneSel) {
    if (!selectorList) return 1;                                     // return error code
    if (selectorList->GetLineCount() > 1) selectorList->ClearLine(); // clear multi line

    // set diaplay name or no selection
    if (!!inputObject) {
        selectorList->SetLine(checkout_title(inputObject), 0, CATDlgDataModify);
    }
    else
        selectorList->SetLine(noneSel, 0, CATDlgDataModify);

    return 0; // ok
}
//-----------------------------------------------------------------------------
int KTCAutoDialog::selectorlist_setline(CATDlgSelectorList*                 selectorList,
                                        const CATListValCATISpecObject_var& iList,
                                        const CATUnicodeString&             noneSel) {
    if (!selectorList) return 1;                                     // return error code
    if (selectorList->GetLineCount() > 1) selectorList->ClearLine(); // clear multi line

    if (iList.Size() == 0) {
        selectorList->ClearLine(); // clear multi line
        selectorList->SetLine(noneSel, 0, CATDlgDataModify);
        return 0;
    }

    CATISpecObject_var object;
    CATUnicodeString   title;

    // loop ,list index from 1
    for (size_t i = 1; i <= iList.Size(); i++) {
        object = iList[ i ]; // get object

        if (!!object)
            title = checkout_title(object);
        else
            title = "(NULL Object)";

        // selector index from 0
        selectorList->SetLine(title, i - 1, CATDlgDataModify);
    }

    return iList.Size();

} //-----------------------------------------------------------------------------
//----------------------------------------
void KTCAutoDialog::SendValueCHangeNotification() {
    CATCommand* cmd = GetFather();                   // get command
    if (cmd) SendNotification(cmd, valueChangeNtf_); // set notification
}
//-------------------------------------------------------------------------
void KTCAutoDialog::SetActiveField(int feild) {
    if (selectorMap_ == NULL) return;
    activeField_ = feild;

    // clear other field select
    for (KTCAutoSelectorCtxMap::iterator it = selectorMap_->begin(); it != selectorMap_->end();
         it++) {
        if (it->second == NULL || it->second->fieldKey == activeField_)
            continue; // 当前字段不处理，跳过

        it->second->ClearSelect(); // 清除其他字段的选择
    }
}
//-------------------------------------------------------------------------
void KTCAutoDialog::SetActiveFieldFocus() {
    if (selectorMap_ == NULL) return;
    KTCAutoSelectorCtxMap::iterator it = selectorMap_->find(activeField_);
    if (it != selectorMap_->end()) it->second->SetSelect();
}
//-----------------------------------------------------------------------------
void KTCAutoDialog::ShowMessageBox(const CATUnicodeString& msg, CATDialog* dialog) {
    ShowMessageBox(0, msg, dialog);
}
//-----------------------------------------------------------------------------
void KTCAutoDialog::ShowMessageBox(int code, const CATUnicodeString& msg, CATDialog* dialog) {
    if (0 == code && msg.GetLengthInChar() == 0) return; // 没有错误信息，不弹出

    if (!dialog) dialog = (CATApplicationFrame::GetApplicationFrame())->GetMainWindow();

    // 创建消息通知对话框
    CATDlgNotify* notify = NULL;
    if (code != 0) { // 有错误
        // message
        CATUnicodeString num;   // code
        num.BuildFromNum(code); // code to string

        // 没有输入msg就显示空信息，code等
        CATUnicodeString message = "[ERROR " + num + "]\n" + msg;

        // 弹出
        notify = new CATDlgNotify(dialog, "Error", CATDlgNfyError);
        notify->DisplayBlocked(message, "Error"); // 显示对话框（模态）
    }
    else { // 没有错误
        notify = new CATDlgNotify(dialog, "Information", CATDlgNfyInformation);
        notify->DisplayBlocked(msg, "Information"); // 显示对话框（模态）
    }

    KTCRequestDelayedDestruction(notify); // 释放资源
}
//-----------------------------------------------------------------------------
void KTCAutoDialog::ShowMessageBox(int code, const KtString& msg, CATDialog* dialog) {
    if (0 == code && msg.size() == 0) return; // 没有错误信息，不弹出
    CATUnicodeString message = msg.str();     // 从本地码转换
    ShowMessageBox(code, message, dialog);    // 调用CAA参数的信息框
}
//-----------------------------------------------------------------------------
void KTCAutoDialog::ShowMessageBox(int code, const char* msg, CATDialog* dialog) {
    if (0 == code && msg == NULL) return;  // 没有错误信息，不弹出
    CATUnicodeString message = msg;        // 从本地码转换
    ShowMessageBox(code, message, dialog); // 调用CAA参数的信息框
}
