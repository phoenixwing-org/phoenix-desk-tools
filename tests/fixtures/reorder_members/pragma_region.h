#ifndef SamplePragmaRegion_H
#define SamplePragmaRegion_H

class SamplePragmaRegion {
public:
    void zebra();
    void apple();

public:
#pragma region GeneratedFields
    int field_z_first;
    int field_a_second;
#pragma endregion

    void beta();
};

#endif
