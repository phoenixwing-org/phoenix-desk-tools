#ifndef SampleCaa2Wizard_H
#define SampleCaa2Wizard_H

class SampleCaa2Wizard {
public:
    void OnApply();
    void OnCancel();

public:
    //CAA2 WIZARD
    void* _PushButtonApply;
    void* _LabelTitle;
    void* _ComboSelector;
    //END CAA2 WIZARD
};

#endif
